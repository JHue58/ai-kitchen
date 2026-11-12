package service

import (
	"ai-kitchen/internal/calculator"
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

// Existing generation fixtures exercise the original flow with reuse explicitly disabled.
var reuseDisabledForLegacyTests = false

func TestHistorySearchAndReuse(t *testing.T) {
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "reuse.db")
	db, err := repository.Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	menu, err := parseGeneratedRecipe([]byte(validGeneratedRecipe))
	if err != nil {
		t.Fatal(err)
	}
	menu.Dishes[0].Cost = 5
	menu.Sources = []model.Source{{URL: "https://example.com/eggs", Title: "原菜谱"}}
	doc, err := Save(db, 1, "recipes", menu)
	if err != nil {
		t.Fatal(err)
	}
	_, err = Save(db, 2, "recipes", menu)
	if err != nil {
		t.Fatal(err)
	}
	single := model.DishRecord{Dish: menu.Dishes[0], Servings: 2}
	if _, err = Save(db, 1, "dishes", single); err != nil {
		t.Fatal(err)
	}
	single.Servings = 3
	if _, err = Save(db, 1, "dishes", single); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	q := model.Request{Servings: 2, Mode: "strict", Ingredients: []string{"鸡蛋"}}
	tool := existingDishTool(db, 1, q)
	for _, tc := range []struct {
		args  string
		count int
	}{
		{`{}`, 2},
		{`{"query":"晚餐","ingredients":["蛋"],"tags":["家常菜"],"max_cost":5,"max_minutes":10}`, 1},
		{`{"kind":"dishes","servings":3}`, 1},
		{`{"max_cost":4}`, 0},
		{`{"max_minutes":9}`, 0},
		{`{"exclude_ingredients":["鸡蛋"]}`, 0},
		{`{"tags":["素食"]}`, 0},
	} {
		result, err := tool.Run(ctx, json.RawMessage(tc.args))
		if err != nil {
			t.Fatal(err)
		}
		if result.(map[string]any)["total"] != tc.count {
			t.Fatalf("%s: %+v", tc.args, result)
		}
	}
	result, err := tool.Run(ctx, json.RawMessage(`{"limit":1,"offset":1}`))
	if err != nil {
		t.Fatal(err)
	}
	page := result.(map[string]any)
	if len(page["items"].([]existingDish)) != 1 || page["has_more"] != false {
		t.Fatalf("bad page: %+v", page)
	}
	for _, args := range []string{`{"kind":"users"}`, `{"offset":-1}`, `{"limit":21}`} {
		if _, err := tool.Run(ctx, json.RawMessage(args)); err == nil {
			t.Fatalf("accepted %s", args)
		}
	}
	var root map[string]any
	if err = json.Unmarshal([]byte(validGeneratedRecipe), &root); err != nil {
		t.Fatal(err)
	}
	root["dishes"] = []any{map[string]any{"reuse_from": model.DishReference{Kind: "recipes", ID: doc.ID, StartOffset: 5}}}
	raw, _ := json.Marshal(root)
	reused, err := parseRecipeWithReuse(ctx, db, 1, q, raw)
	if err != nil {
		t.Fatal(err)
	}
	if reused.Dishes[0].Ingredients[0].Quantity != 2 || reused.Dishes[0].Steps[0].Start != 5 || reused.Dishes[0].ReuseFrom.ID != doc.ID || len(reused.Sources) != 1 {
		t.Fatalf("snapshot not preserved: %+v", reused)
	}
	if v := calculator.Validate(reused, q, model.Preferences{Allergies: []string{"鸡蛋"}}, nil, nil); len(v) == 0 {
		t.Fatal("reuse bypassed allergy constraints")
	}
	// A menu may combine a reference with a freshly generated dish.
	var freshRoot map[string]json.RawMessage
	json.Unmarshal([]byte(validGeneratedRecipe), &freshRoot)
	var freshDishes []json.RawMessage
	json.Unmarshal(freshRoot["dishes"], &freshDishes)
	root["dishes"] = []any{map[string]any{"reuse_from": model.DishReference{Kind: "recipes", ID: doc.ID}}, freshDishes[0]}
	mixedJSON, _ := json.Marshal(root)
	mixed, err := parseRecipeWithReuse(ctx, db, 1, q, mixedJSON)
	if err != nil || len(mixed.Dishes) != 2 || mixed.Dishes[0].ReuseFrom == nil || mixed.Dishes[1].ReuseFrom != nil {
		t.Fatalf("mixed menu failed: %+v %v", mixed, err)
	}
	for _, tc := range []struct {
		uid uint
		q   model.Request
	}{{2, q}, {1, model.Request{Servings: 3}}} {
		if _, err := parseRecipeWithReuse(ctx, db, tc.uid, tc.q, raw); err == nil {
			t.Fatalf("accepted inaccessible or incompatible reference: %+v", tc)
		}
	}
	disabled := false
	q.ReuseExisting = &disabled
	if _, err := parseRecipeWithReuse(ctx, db, 1, q, raw); err == nil {
		t.Fatal("reuse accepted while disabled")
	}
	for _, enabled := range []bool{true, false} {
		q.ReuseExisting = &enabled
		sources := []model.Source{}
		warnings := []string{}
		tools := agentTools(db, c, model.Job{UserID: 1}, q, model.Preferences{}, nil, nil, nil, &sources, &warnings)
		found := false
		for _, tool := range tools {
			if tool.Name == "search_existing_dishes" {
				found = true
				if !tool.Required {
					t.Fatal("history search must be attempted")
				}
			}
		}
		if found != enabled {
			t.Fatalf("tool gating failed: %v", enabled)
		}
	}
	// Explicitly test missing image in old stored snapshots and invalid reference indexes.
	root["dishes"] = []any{map[string]any{"reuse_from": map[string]any{"kind": "recipes", "id": doc.ID, "dish_index": 99}}}
	raw, _ = json.Marshal(root)
	if _, err := parseRecipeWithReuse(ctx, db, 1, model.Request{Servings: 2}, raw); err == nil {
		t.Fatal("accepted invalid index")
	}

}

func TestGenerationReusesSnapshots(t *testing.T) {
	for _, target := range []string{"menu", "dish"} {
		t.Run(target, func(t *testing.T) {
			var c config.Config
			c.Database.Driver = "sqlite"
			c.Database.DSN = filepath.Join(t.TempDir(), "generation.db")
			db, err := repository.Open(c)
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { sqlDB.Close() })
			user := model.User{Username: "reuse-chef"}
			if err := db.Create(&user).Error; err != nil {
				t.Fatal(err)
			}
			original, _ := parseGeneratedRecipe([]byte(validGeneratedRecipe))
			original.Dishes[0].Image = &model.DishImage{URL: "https://example.com/eggs.jpg", SourceURL: "https://example.com/eggs", Title: "鸡蛋"}
			original.Sources = []model.Source{{URL: "https://example.com/eggs", Title: "原来源"}}
			doc, err := Save(db, user.ID, "recipes", original)
			if err != nil {
				t.Fatal(err)
			}
			var root map[string]any
			json.Unmarshal([]byte(validGeneratedRecipe), &root)
			root["dishes"] = []any{map[string]any{"reuse_from": model.DishReference{Kind: "recipes", ID: doc.ID}}}
			raw, _ := json.Marshal(root)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/chat/completions" {
					t.Error("reused dishes should not need a web or image search")
					w.WriteHeader(500)
					return
				}
				var body struct {
					Messages []json.RawMessage `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				message := map[string]any{"role": "assistant", "content": string(raw)}
				name, args := "", "{}"
				if len(body.Messages) == 2 {
					name = "search_existing_dishes"
				}
				if len(body.Messages) == 4 {
					name = "check_menu"
					b, _ := json.Marshal(map[string]string{"recipe": string(raw)})
					args = string(b)
				}
				if name != "" {
					message = map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": name, "type": "function", "function": map[string]string{"name": name, "arguments": args}}}}
				}
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
			}))
			defer upstream.Close()
			c.LLM.Enabled, c.LLM.VisionEnabled = true, true
			c.LLM.Model, c.LLM.APIKey, c.LLM.BaseURL, c.LLM.TimeoutSeconds = "test", "test", upstream.URL, 5
			c.Search.Enabled, c.Search.APIKey, c.Search.BaseURL = true, "test", upstream.URL
			request := model.Request{Target: target, Servings: 2, Mode: "strict", Ingredients: []string{"鸡蛋"}, Search: true, DishCount: 1}
			requestJSON, _ := json.Marshal(request)
			job := model.Job{UserID: user.ID, Status: "pending", Request: string(requestJSON)}
			if err := db.Create(&job).Error; err != nil {
				t.Fatal(err)
			}
			run(context.Background(), db, c, job)
			db.First(&job, job.ID)
			if job.Status != "completed" {
				t.Fatalf("job failed: %s", job.Error)
			}
			var saved model.Document
			db.First(&saved, job.RecipeID)
			items, err := dishesInDocument(saved)
			if err != nil || len(items) != 1 {
				t.Fatalf("invalid saved snapshot: %+v %v", items, err)
			}
			if items[0].Dish.Image == nil || items[0].Dish.Image.URL != original.Dishes[0].Image.URL || items[0].Dish.Steps[0].Description != original.Dishes[0].Steps[0].Description || len(items[0].Sources) != 1 {
				t.Fatalf("lost original data: %+v", items[0])
			}
			if target == "dish" && job.ResultKind != "dishes" || target == "menu" && job.ResultKind != "recipes" {
				t.Fatal("incorrect result collection")
			}
		})
	}
}
