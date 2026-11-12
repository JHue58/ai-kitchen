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
	"strings"
	"testing"
)

func TestGenerationIncludesScopedGlobalPrompts(t *testing.T) {
	personal, other := "", ""
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Messages) < 2 {
			t.Error("missing messages")
			w.WriteHeader(500)
			return
		}
		prompt := body.Messages[0].Content
		if body.Messages[0].Role != "system" || !strings.Contains(prompt, "全站共同要求") || !strings.Contains(prompt, personal) || strings.Contains(prompt, other) {
			t.Errorf("incorrect scoped prompt for %s", personal)
		}
		w.Header().Set("Content-Type", "application/json")
		if len(body.Messages) == 2 {
			args, _ := json.Marshal(map[string]string{"recipe": validGeneratedRecipe})
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "check", "type": "function", "function": map[string]string{"name": "check_menu", "arguments": string(args)}}}}}}})
			return
		}
		content := validGeneratedRecipe
		if !strings.Contains(body.Messages[1].Content, "repair_error") {
			content = `{}` // Valid JSON with a missing menu contract triggers run's repair path.
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}}}})
	}))
	defer upstream.Close()
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	c.LLM.Enabled = true
	c.LLM.Model = "test"
	c.LLM.APIKey = "test"
	c.LLM.BaseURL = upstream.URL
	c.LLM.TimeoutSeconds = 5
	db, err := repository.Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	db.Create(&model.Setting{Key: GlobalPromptKey, Value: "全站共同要求"})
	for _, user := range []struct {
		id            uint
		prompt, other string
	}{{1, "甲用户专属要求", "乙用户专属要求"}, {2, "乙用户专属要求", "甲用户专属要求"}} {
		if err := db.Create(&model.User{ID: user.id, Username: user.prompt}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := Save(db, user.id, "preferences", model.Preferences{Theme: "light", GlobalPrompt: user.prompt}); err != nil {
			t.Fatal(err)
		}
		personal, other = user.prompt, user.other
		for _, target := range []string{"menu", "dish"} {
			q, _ := json.Marshal(model.Request{Target: target, Mode: "strict", Servings: 2, Ingredients: []string{"鸡蛋"}})
			job := model.Job{UserID: user.id, Status: "pending", Request: string(q)}
			db.Create(&job)
			run(context.Background(), db, c, job)
			db.First(&job, job.ID)
			if job.Status != "completed" {
				t.Fatalf("job failed: %+v", job)
			}
		}
	}
	if calls != 16 {
		t.Fatalf("expected all tool rounds, got %d", calls)
	}
}

func TestEmptyGlobalPromptsKeepBuiltinPrompt(t *testing.T) {
	q := model.Request{Mode: "random"}
	if PromptWithGlobals(q, false, "", "") != SystemPrompt(q, false) {
		t.Fatal("empty settings changed prompt")
	}
}
