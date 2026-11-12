package service

import (
	"ai-kitchen/internal/ai"
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

func TestWebSearchAndVisualValidation(t *testing.T) {
	clear := true
	visionCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tools/fetch":
			json.NewEncoder(w).Encode(map[string]string{"content": "菜谱正文，成品图 https://example.com/eggs.jpg"})
		case "/v1/tools/search":
			json.NewEncoder(w).Encode(map[string]any{"results": []model.Source{{URL: "https://example.com/recipe", Content: `![鸡蛋](https://example.com/eggs.jpg)`}}})
		case "/chat/completions":
			visionCalls++
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			raw, _ := json.Marshal(body["messages"])
			if body["model"] != "configured-vision" || !strings.Contains(string(raw), "image_url") || !strings.Contains(string(raw), "https://example.com/") {
				t.Errorf("missing configured multimodal request: %s", raw)
			}
			result, _ := json.Marshal(ai.ImageAssessment{Description: "炒鸡蛋", Matches: true, Clear: clear, Reason: "可辨认菜品主体"})
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(result)}}}})
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	c.Search.Enabled = true
	c.Search.APIKey = "test"
	c.Search.BaseURL = upstream.URL
	c.Search.ResultCount = 5
	c.LLM.Enabled = true
	c.LLM.VisionEnabled = true
	c.LLM.APIKey = "test"
	c.LLM.BaseURL = upstream.URL
	c.LLM.Model = "configured-vision"
	c.LLM.TimeoutSeconds = 5
	db, err := repository.Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	sources := []model.Source{}
	warnings := []string{}
	images := map[string]model.DishImage{}
	makeTools := func() map[string]ai.Tool {
		registry := map[string]ai.Tool{}
		for _, tool := range agentTools(db, c, model.Job{}, model.Request{Search: true}, model.Preferences{}, nil, nil, nil, &sources, &warnings, images) {
			registry[tool.Name] = tool
		}
		return registry
	}
	registry := makeTools()
	if len(registry) != 4 {
		t.Fatalf("unexpected tools: %+v", registry)
	}
	run := func(name, args string) error {
		_, err := registry[name].Run(context.Background(), json.RawMessage(args))
		return err
	}
	if err := run("view_image", `{"url":"https://example.com/unknown.jpg","dish":"鸡蛋"}`); err != nil || visionCalls != 1 || images["https://example.com/unknown.jpg"].URL == "" {
		t.Fatalf("undiscovered public image should be visually checked: %v", err)
	}
	delete(images, "https://example.com/unknown.jpg")
	if err := run("search_web", `{"query":"鸡蛋成品图片"}`); err != nil {
		t.Fatal(err)
	}
	if len(images) != 0 {
		t.Fatal("search alone must not approve images")
	}
	args := `{"url":"https://example.com/eggs.jpg","dish":"炒鸡蛋"}`
	if err := run("view_image", args); err != nil || len(images) != 1 {
		t.Fatalf("visual approval failed: %v %+v", err, images)
	}
	clear = false
	if err := run("view_image", args); err != nil || len(images) != 0 {
		t.Fatalf("blurred image accepted: %v %+v", err, images)
	}
	// Fetch is independent of search, and returns the original content directly.
	result, err := registry["fetch_page"].Run(context.Background(), json.RawMessage(`{"url":"https://example.com/not-searched"}`))
	if err != nil || result != "菜谱正文，成品图 https://example.com/eggs.jpg" {
		t.Fatalf("fetch rejected new URL or split content: %v %+v", err, result)
	}
	if sources[len(sources)-1].URL != "https://example.com/not-searched" {
		t.Fatal("fetched page missing from sources")
	}
	for _, target := range []string{"http://127.0.0.1/private", "file:///etc/passwd"} {
		args, _ := json.Marshal(map[string]string{"url": target})
		if _, err := registry["fetch_page"].Run(context.Background(), args); err == nil {
			t.Fatalf("accepted unsafe URL: %s", target)
		}
		if _, err := registry["view_image"].Run(context.Background(), args); err == nil {
			t.Fatalf("accepted unsafe image URL: %s", target)
		}
	}
	c.LLM.VisionEnabled = false
	if _, ok := makeTools()["view_image"]; ok {
		t.Fatal("disabled vision advertised")
	}
}
