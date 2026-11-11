package service

import (
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
			recipe := `{"title":"鸡蛋晚餐","servings":2,"dishes":[{"name":"鸡蛋","ingredients":[{"name":"鸡蛋","quantity":2,"unit":"个","estimated_edible_weight_g":100,"estimated_price_per_kg":20}],"equipment":[],"steps":[{"title":"制作","description":"充分加热","duration_minutes":10,"start_minute":0}]}],"energy_usage":[]}`
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": recipe}}}})
		default:
			t.Error("unexpected upstream path")
		}
	}))
	defer upstream.Close()
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	c.LLM.Enabled = true
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
	request := model.Request{Servings: 2, Mode: "strict", Ingredients: []string{"鸡蛋"}, Search: true}
	b, _ := json.Marshal(request)
	for i := 0; i < 2; i++ {
		job := model.Job{UserID: user.ID, Status: "pending", Request: string(b)}
		db.Create(&job)
		run(context.Background(), db, c, job)
		db.First(&job, job.ID)
		if len(job.Events) < 6 || job.Events[0].Status != "pending" || job.Events[len(job.Events)-1].Status != "completed" {
			t.Fatalf("missing persisted progress: %+v", job.Events)
		}
		if job.Status != "completed" || job.RecipeID == 0 {
			t.Fatalf("job failed %+v", job)
		}
	}
	if calls["/v1/tools/search"] != 1 || calls["/v1/tools/fetch"] != 1 || calls["/chat/completions"] != 2 {
		t.Fatalf("cache not used: %v", calls)
	}
	recipes := Read[model.Recipe](db, user.ID, "recipes")
	if len(recipes) != 2 || recipes[0].Cost != 2 || recipes[0].Nutrition.Calories != 143 {
		t.Fatalf("bad calculated recipe %+v", recipes)
	}
}

func TestDishTagsAreIndependent(t *testing.T) {
	r := model.Recipe{Dishes: []model.Dish{{Tags: []string{"汤", "减脂餐", "汤", "不存在"}}, {Tags: []string{"自定义"}}, {Tags: []string{"不存在"}}}}
	NormalizeDishTags(&r, []string{"汤", "减脂餐", "自定义"})
	if len(r.Dishes[0].Tags) != 2 || r.Dishes[0].Tags[0] != "汤" || r.Dishes[0].Tags[1] != "减脂餐" || r.Dishes[1].Tags[0] != "自定义" || r.Dishes[2].Tags[0] != "未知" {
		t.Fatalf("incorrect dish tags: %+v", r.Dishes)
	}
}
