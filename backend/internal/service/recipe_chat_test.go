package service

import (
	"ai-kitchen/internal/calculator"
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func chatFixture(t *testing.T) (*gorm.DB, config.Config, model.Document, map[string]any) {
	t.Helper()
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "chat.db")
	c.LLM.Enabled = true
	c.LLM.APIKey = "test"
	c.LLM.Model = "test-agent"
	c.LLM.TimeoutSeconds = 1
	db, err := repository.Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	r := model.Recipe{Title: "三菜晚餐", Servings: 2, Tags: []string{"家常菜"}, Summary: "测试", Tips: []string{}, Substitutions: []string{}, Request: model.Request{Servings: 2, DishCount: 3, Mode: "random"}}
	for _, name := range []string{"鸡蛋", "牛肉", "豆腐"} {
		price := 20.0
		r.Dishes = append(r.Dishes, model.Dish{Name: name, Description: "煎香", Tags: []string{"家常菜"}, Commentary: "少油煎香", Ingredients: []model.Ingredient{{Name: name, Category: "main", Quantity: 200, Unit: "g", Price: &price}, {Name: "盐", Category: "seasoning", Quantity: 2, Unit: "g", Price: &price}}, Steps: []model.Step{{Step: 1, Title: "煎香", Description: "小火煎至熟透", Duration: 10}}, Usage: []model.Usage{}, Equipment: []uint{}})
	}
	calculator.Calculate(&r, nil, nil, nil, model.Preferences{})
	doc, err := Save(db, 1, "recipes", r)
	if err != nil {
		t.Fatal(err)
	}
	// Generation tool summaries must never become follow-up conversation context.
	if err := db.Create(&model.Job{UserID: 1, RecipeID: doc.ID, Events: []model.JobEvent{{Message: "GENERATION_TRACE_PRIVATE_MARKER"}}}).Error; err != nil {
		t.Fatal(err)
	}
	var original map[string]any
	json.Unmarshal([]byte(doc.Data), &original)
	return db, c, doc, original
}

func answerJSON(w http.ResponseWriter, reply string, updated bool) {
	content, _ := json.Marshal(map[string]any{"reply": reply, "updated": updated})
	json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}, "finish_reason": "stop"}}})
}

func callChatTool(w http.ResponseWriter, changes map[string]any) {
	args, _ := json.Marshal(changes)
	json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"tool_calls": []any{map[string]any{"id": "edit", "type": "function", "function": map[string]string{"name": "apply_recipe_changes", "arguments": string(args)}}}}, "finish_reason": "tool_calls"}}})
}

func secondDishChange(original map[string]any) map[string]any {
	ingredients := copyRecipeMap(original)["dishes"].([]any)[1].(map[string]any)["ingredients"].([]any)
	ingredients[0].(map[string]any)["name"] = "鸡胸肉"
	return map[string]any{"menu_changes": map[string]any{}, "dish_updates": []any{map[string]any{"index": 1, "changes": map[string]any{"name": "香煎鸡胸肉", "ingredients": ingredients, "ai_commentary": "蛋白质丰富，注意不要煎老"}}}}
}

func TestRecipeChatQuestionsHaveSeparatePersistentContext(t *testing.T) {
	db, c, doc, _ := chatFixture(t)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "GENERATION_TRACE_PRIVATE_MARKER") {
			t.Error("generation trace leaked into new chat")
		}
		messages := body["messages"].([]any)
		var input map[string]any
		if err := json.Unmarshal([]byte(messages[1].(map[string]any)["content"].(string)), &input); err != nil {
			t.Fatal(err)
		}
		if input["current_recipe"].(map[string]any)["title"] != "三菜晚餐" {
			t.Error("missing authoritative recipe JSON")
		}
		history, _ := input["followup_history"].([]any)
		if calls == 1 && len(history) != 0 {
			t.Error("new conversation should be empty")
		}
		if calls == 2 && (len(history) != 2 || history[0].(map[string]any)["content"] != "这道菜怎么切？") {
			t.Error("follow-up history not preserved")
		}
		answerJSON(w, "逆着纹理切成薄片，厚度约 3 毫米。", false)
	}))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	for _, question := range []string{"这道菜怎么切？", "那要腌多久？"} {
		result, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, question)
		if err != nil || len(result.ChangedSections) != 0 {
			t.Fatalf("question mutated recipe: %+v %v", result, err)
		}
	}
	var latest model.Document
	db.First(&latest, doc.ID)
	if latest.Data != doc.Data {
		t.Error("answer-only turn rewrote the recipe")
	}
	state, err := GetRecipeChat(db, 1, "recipes", doc.ID)
	if err != nil || len(state.Messages) != 4 || state.Busy || state.Document["id"] != doc.ID {
		t.Fatalf("history did not persist: %+v %v", state, err)
	}
	if _, err := GetRecipeChat(db, 2, "recipes", doc.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-owner chat access: %v", err)
	}
}

func TestRecipeChatEditsOnlyRequestedDishAndIsIdempotent(t *testing.T) {
	db, c, doc, original := chatFixture(t)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			// A background image write and favorite click race with the Agent.
			if err := patchImageDocument(db, doc, func(data map[string]any) {
				data["favorite"] = true
				data["dishes"].([]any)[0].(map[string]any)["image"] = map[string]any{"url": "https://example.com/egg.jpg"}
				data["dishes"].([]any)[1].(map[string]any)["image"] = map[string]any{"url": "https://example.com/beef.jpg"}
			}); err != nil {
				t.Error(err)
			}
			callChatTool(w, secondDishChange(original))
			return
		}
		answerJSON(w, "已把第二道换成鸡胸肉，另外两道保留。", true)
	}))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	result, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "只换第二道，不要牛肉", "request-1")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || result.Document["favorite"] != true {
		t.Fatalf("Agent tool execution or latest metadata lost: %d %+v", calls, result)
	}
	dishes := result.Document["dishes"].([]any)
	expectedFirst := original["dishes"].([]any)[0].(map[string]any)
	expectedFirst["image"] = map[string]any{"url": "https://example.com/egg.jpg"}
	if !reflect.DeepEqual(dishes[0], expectedFirst) || !reflect.DeepEqual(dishes[2], original["dishes"].([]any)[2]) {
		t.Fatal("untouched dish JSON was changed")
	}
	second := dishes[1].(map[string]any)
	if second["name"] != "香煎鸡胸肉" || second["image"] != nil || second["collection_id"] == nil {
		t.Fatalf("replacement not saved correctly: %+v", second)
	}
	if second["nutrition"].(map[string]any)["protein"].(float64) < 40 {
		t.Fatal("modified dish nutrition was not recalculated")
	}
	if !containsSection(result.ChangedSections, "dish-1") || containsSection(result.ChangedSections, "dish-0") || containsSection(result.ChangedSections, "dish-2") {
		t.Fatalf("incorrect highlight sections: %v", result.ChangedSections)
	}
	// An old enrichment task must not attach the old beef image after commit.
	var oldRecipe model.Recipe
	json.Unmarshal([]byte(doc.Data), &oldRecipe)
	if err := patchImageDish(db, doc, 1, oldRecipe.Dishes[1], model.DishImage{URL: "https://example.com/old.jpg"}, &model.TokenUsage{}); err != nil {
		t.Fatal(err)
	}
	duplicate, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "只换第二道，不要牛肉", "request-1")
	if err != nil || calls != 2 || len(duplicate.Messages) != 2 || duplicate.Document["dishes"].([]any)[1].(map[string]any)["image"] != nil {
		t.Fatalf("retry repeated mutation or stale photo attached: %v %d %+v", err, calls, duplicate)
	}
	if _, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "不同要求", "request-1"); !errors.Is(err, ErrChatConflict) {
		t.Fatalf("request id reused with different content: %v", err)
	}
}

func containsSection(sections []string, want string) bool {
	for _, s := range sections {
		if s == want {
			return true
		}
	}
	return false
}

func TestRecipeChatRejectsStaleRecipeAndRollsBackFailedAgent(t *testing.T) {
	for _, mode := range []string{"conflict", "upstream_failure", "invalid_edit"} {
		t.Run(mode, func(t *testing.T) {
			db, c, doc, original := chatFixture(t)
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 1 {
					changes := secondDishChange(original)
					if mode == "invalid_edit" {
						changes["dish_updates"].([]any)[0].(map[string]any)["changes"].(map[string]any)["image"] = map[string]string{"url": "https://example.com/fake.jpg"}
					}
					callChatTool(w, changes)
					return
				}
				if mode == "conflict" {
					if err := patchImageDocument(db, doc, func(data map[string]any) { data["title"] = "另一标签页修改" }); err != nil {
						t.Error(err)
					}
				}
				if mode == "upstream_failure" {
					w.WriteHeader(401)
					return
				}
				answerJSON(w, "已经修改", true)
			}))
			defer upstream.Close()
			c.LLM.BaseURL = upstream.URL
			_, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "只修改第二道")
			if err == nil {
				t.Fatal("failed or conflicting mutation unexpectedly committed")
			}
			if mode == "conflict" && !errors.Is(err, ErrChatConflict) {
				t.Fatal(err)
			}
			state, err := GetRecipeChat(db, 1, "recipes", doc.ID)
			if err != nil || state.Busy || len(state.Messages) != 0 {
				t.Fatalf("failed turn persisted or lease leaked: %+v %v", state, err)
			}
			if !reflect.DeepEqual(state.Document["dishes"], original["dishes"]) {
				t.Fatal("failed Agent changed recipe")
			}
		})
	}
}

func TestRecipeChatLeaseAndPatchValidation(t *testing.T) {
	db, c, doc, original := chatFixture(t)
	state, err := GetRecipeChat(db, 1, "recipes", doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	db.Model(&model.RecipeChat{}).Where("id = ?", state.SessionID).Updates(map[string]any{"lock_token": "other-tab", "locked_at": now})
	if _, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "再问一句"); !errors.Is(err, ErrChatBusy) {
		t.Fatalf("concurrent submission accepted: %v", err)
	}
	changes, err := newRecipeChanges(db, 1, "recipes", original)
	if err != nil {
		t.Fatal(err)
	}
	for _, patch := range []string{
		`{"menu_changes":{"favorite":true},"dish_updates":[]}`,
		`{"menu_changes":{},"dish_updates":[{"index":3,"changes":{"name":"越界"}}]}`,
		`{"menu_changes":{},"dish_updates":[{"index":1,"changes":{"ingredients":[{"name":"盐","quantity":-1,"unit":"g"}]}}]}`,
		`{"menu_changes":{},"dish_updates":[{"index":1,"changes":{"equipment":[999]}}]}`,
	} {
		if _, err := changes.apply(json.RawMessage(patch)); err == nil {
			t.Fatalf("invalid edit accepted: %s", patch)
		}
		if !reflect.DeepEqual(changes.current, original) {
			t.Fatal("rejected patch leaked into candidate")
		}
	}
}

func TestImageEnrichmentRejectsChangedMainIngredientWithSameName(t *testing.T) {
	db, _, doc, original := chatFixture(t)
	var oldRecipe model.Recipe
	json.Unmarshal([]byte(doc.Data), &oldRecipe)
	if err := patchImageDocument(db, doc, func(data map[string]any) {
		data["dishes"].([]any)[1].(map[string]any)["ingredients"].([]any)[0].(map[string]any)["name"] = "鸡胸肉"
	}); err != nil {
		t.Fatal(err)
	}
	if err := patchImageDish(db, doc, 1, oldRecipe.Dishes[1], model.DishImage{URL: "https://example.com/beef.jpg"}, &model.TokenUsage{}); err != nil {
		t.Fatal(err)
	}
	var latest model.Document
	db.First(&latest, doc.ID)
	var data map[string]any
	json.Unmarshal([]byte(latest.Data), &data)
	if data["dishes"].([]any)[1].(map[string]any)["image"] != original["dishes"].([]any)[1].(map[string]any)["image"] {
		t.Fatal("old image attached after main ingredient changed")
	}
}

func TestRecipeChatCanAdjustIndependentDish(t *testing.T) {
	db, c, menu, original := chatFixture(t)
	var recipe model.Recipe
	json.Unmarshal([]byte(menu.Data), &recipe)
	doc, _, err := repository.SaveDishSnapshot(db, 1, model.DishRecord{Dish: recipe.Dishes[0], Servings: 2, Favorite: true, Request: model.Request{Target: "dish", Servings: 2, DishCount: 1}})
	if err != nil {
		t.Fatal(err)
	}
	oldKey := *doc.CollectionKey
	ingredients := original["dishes"].([]any)[0].(map[string]any)["ingredients"].([]any)
	ingredients[1].(map[string]any)["quantity"] = float64(1)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			callChatTool(w, map[string]any{"menu_changes": map[string]any{}, "dish_updates": []any{map[string]any{"index": 0, "changes": map[string]any{"ingredients": ingredients}}}})
			return
		}
		answerJSON(w, "盐减为 1 克。", true)
	}))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	result, err := ReplyRecipeChat(context.Background(), db, c, 1, "dishes", doc.ID, "这道菜的盐减半", "salt-half")
	if err != nil {
		t.Fatal(err)
	}
	if result.Document["favorite"] != true || result.Document["ingredients"].([]any)[1].(map[string]any)["quantity"] != float64(1) {
		t.Fatal("single dish edit not preserved", result.Document)
	}
	var latest model.Document
	db.First(&latest, doc.ID)
	if latest.CollectionKey == nil || *latest.CollectionKey == oldKey {
		t.Fatal("edited snapshot identity not updated")
	}
	if !containsSection(result.ChangedSections, "dish-0") || !containsSection(result.ChangedSections, "ingredients") {
		t.Fatal("single-dish effects missing", result.ChangedSections)
	}
}
