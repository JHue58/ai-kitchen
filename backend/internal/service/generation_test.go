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
	"strings"
	"testing"
)

func TestGenerationWithSearchAndFetch(t *testing.T) {
	calls := map[string]int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls[r.URL.Path]++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/tools/search":
			json.NewEncoder(w).Encode(map[string]any{"results": []any{map[string]any{"title": "参考菜谱", "url": "https://example.com/recipe", "rerank_score": 2.4}}})
		case "/v1/tools/fetch":
			json.NewEncoder(w).Encode(map[string]string{"content": "参考正文"})
		case "/chat/completions":
			recipe := validGeneratedRecipe
			var request struct {
				Messages []struct {
					Role string `json:"role"`
				} `json:"messages"`
				Tools []any `json:"tools"`
			}
			json.NewDecoder(r.Body).Decode(&request)
			if len(request.Tools) == 0 {
				t.Error("missing agent tools")
			}
			name, args := "", ""
			if len(request.Messages) == 2 {
				name = "search_web"
				args = `{"query":"鸡蛋 家常做法"}`
			} else if len(request.Messages) == 4 {
				name = "fetch_page"
				args = `{"url":"https://example.com/recipe"}`
			}
			if len(request.Messages) == 6 {
				name = "check_menu"
				b, _ := json.Marshal(map[string]string{"recipe": recipe})
				args = string(b)
			}
			if name != "" {
				json.NewEncoder(w).Encode(map[string]any{"usage": map[string]int{"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}, "choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": name, "type": "function", "function": map[string]string{"name": name, "arguments": args}}}}}}})
				return
			}

			json.NewEncoder(w).Encode(map[string]any{"usage": map[string]int{"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}, "choices": []any{map[string]any{"message": map[string]string{"content": recipe}}}})
		default:
			t.Error("unexpected upstream path")
		}
	}))
	defer upstream.Close()
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	c.LLM.Enabled = true
	c.LLM.VisionEnabled = true
	c.LLM.APIKey = "test"
	c.LLM.Model = "test"
	c.LLM.BaseURL = upstream.URL
	c.LLM.TimeoutSeconds = 5
	c.Search.Enabled = true
	c.Search.APIKey = "test"
	c.Search.BaseURL = upstream.URL
	c.Search.ResultCount = 5
	c.Search.MaxFetchPages = 1
	c.Search.CacheTTLMinutes = 60
	db, e := repository.Open(c)
	if e != nil {
		t.Fatal(e)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	user := model.User{Username: "chef"}
	db.Create(&user)
	request := model.Request{ReuseExisting: &reuseDisabledForLegacyTests, Servings: 2, Mode: "strict", Ingredients: []string{"鸡蛋"}, Search: true}
	b, _ := json.Marshal(request)
	for i := 0; i < 2; i++ {
		if i == 1 {
			request.Target = "dish"
			request.DishCount = 1
			b, _ = json.Marshal(request)
		}
		job := model.Job{UserID: user.ID, Status: "pending", Request: string(b)}
		db.Create(&job)
		run(context.Background(), db, c, job)
		db.First(&job, job.ID)
		if len(job.Events) < 6 || job.Events[0].Status != "pending" || job.Events[len(job.Events)-1].Status != "completed" {
			t.Fatalf("missing persisted progress: %+v", job.Events)
		}
		foundQuery, foundHost, foundResult := false, false, false
		for _, event := range job.Events {
			if event.Status == "search_web" && event.Detail == "鸡蛋 家常做法" {
				foundQuery = true
			}
			if event.Status == "fetch_page" && event.Detail == "example.com" {
				foundHost = true
			}
			if event.Status == "check_menu" && event.Message == "候选方案核算完成" {
				foundResult = true
			}
		}
		if !foundQuery || !foundHost || !foundResult {
			t.Fatalf("missing actual tool activity: %+v", job.Events)
		}
		if job.Status != "completed" || job.RecipeID == 0 {
			t.Fatalf("job failed %+v", job)
		}
		var delivered model.Document
		db.First(&delivered, job.RecipeID)
		if strings.Contains(delivered.Data, `"image_status":"pending"`) {
			t.Fatal("image search started without personal opt-in")
		}
		if i == 0 {
			autoDishes := Read[model.DishRecord](db, user.ID, "dishes")
			var menuDoc model.Document
			db.First(&menuDoc, job.RecipeID)
			var menu model.Recipe
			json.Unmarshal([]byte(menuDoc.Data), &menu)
			if len(autoDishes) != 1 || len(menu.Dishes) != 1 || menu.Dishes[0].CollectionID == 0 {
				t.Fatal("generated menu dishes were not automatically collected")
			}
		}
	}
	if calls["/v1/tools/search"] != 1 || calls["/v1/tools/fetch"] != 1 || calls["/chat/completions"] != 8 {
		t.Fatalf("cache not used: %v", calls)
	}
	dishes := Read[model.DishRecord](db, user.ID, "dishes")
	if len(dishes) != 1 || dishes[0].Name != "鸡蛋" || dishes[0].Servings != 2 {
		t.Fatalf("single dish was not independently persisted: %+v", dishes)
	}
	if dishes[0].Commentary != "蛋香浓郁，注意充分加热" || dishes[0].Usage == nil || dishes[0].Ingredients[0].Category != "main" {
		t.Fatalf("single dish lost commentary, energy or ingredient role: %+v", dishes[0])
	}
	recipes := Read[model.Recipe](db, user.ID, "recipes")
	if len(recipes) != 1 || recipes[0].Cost != 2 || recipes[0].Nutrition.Calories != 143 {
		t.Fatalf("bad calculated recipe %+v", recipes)
	}
	for _, usage := range []*model.TokenUsage{recipes[0].TokenUsage, dishes[0].TokenUsage} {
		if usage == nil || usage.Calls != 4 || usage.InputTokens != 400 || usage.OutputTokens != 80 || usage.TotalTokens != 480 || usage.MissingCalls != 0 {
			t.Fatalf("generation usage not persisted correctly: %+v", usage)
		}
	}
}

func TestDishTagsAreIndependent(t *testing.T) {
	r := model.Recipe{Dishes: []model.Dish{{Tags: []string{"汤", "减脂餐", "汤", "不存在"}}, {Tags: []string{"自定义"}}, {Tags: []string{"不存在"}}}}
	NormalizeDishTags(&r, []string{"汤", "减脂餐", "自定义"})
	if len(r.Dishes[0].Tags) != 2 || r.Dishes[0].Tags[0] != "汤" || r.Dishes[0].Tags[1] != "减脂餐" || r.Dishes[1].Tags[0] != "自定义" || r.Dishes[2].Tags[0] != "未知" {
		t.Fatalf("incorrect dish tags: %+v", r.Dishes)
	}
}

func TestModePromptsAndSingleDish(t *testing.T) {
	for _, mode := range []string{"random", "mixed", "strict"} {
		prompt := SystemPrompt(model.Request{Mode: mode, Target: "dish", DishCount: 1}, true)
		if !strings.Contains(prompt, "search_web") || !strings.Contains(prompt, "恰好包含一道") || !strings.Contains(prompt, map[string]string{"random": "当前为灵感模式", "mixed": "当前为混合模式", "strict": "当前为限制模式"}[mode]) {
			t.Fatalf("missing rules for %s", mode)
		}
	}
	if strings.Contains(SystemPrompt(model.Request{Mode: "random"}, false), "联网已开启") {
		t.Fatal("disabled search advertised")
	}
	r := model.Recipe{Servings: 2, Dishes: []model.Dish{{}, {}}}
	if len(calculator.Validate(r, model.Request{Servings: 2, Target: "dish"}, model.Preferences{}, nil, nil)) == 0 {
		t.Fatal("multiple dishes accepted for single dish")
	}
}
