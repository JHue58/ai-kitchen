package ai

import (
	"ai-kitchen/internal/config"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentToolErrorsAndHistory(t *testing.T) {
	calls := 0
	executed := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Messages []message `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if calls == 1 {
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"tool_calls": []any{map[string]any{"id": "x", "type": "function", "function": map[string]string{"name": "unknown", "arguments": "{}"}}}}}}})
			return
		}
		if len(body.Messages) != 4 || body.Messages[3].ToolCallID != "x" || !strings.Contains(body.Messages[3].Content, "error") {
			t.Errorf("missing tool error history: %+v", body.Messages)
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "{}"}}}})
	}))
	defer server.Close()
	var c config.Config
	c.LLM.Enabled = true
	c.LLM.APIKey = "test"
	c.LLM.Model = "test"
	c.LLM.BaseURL = server.URL
	raw, err := Agent(context.Background(), c, "system", "input", []Tool{{Name: "allowed", Run: func(context.Context, json.RawMessage) (any, error) { executed++; return nil, nil }}}, func(string) {})
	if err != nil || string(raw) != "{}" || executed != 0 || calls != 2 {
		t.Fatalf("unexpected result %s %v %d %d", raw, err, executed, calls)
	}
}

func TestProgressDetailsExposeOnlyUsefulActivity(t *testing.T) {
	if got := toolDetail("fetch_page", `{"url":"https://user:secret@example.com/recipe?token=private"}`); got != "example.com" {
		t.Fatalf("URL credentials or query exposed: %q", got)
	}
	if got := toolDetail("check_menu", `{"recipe":"private raw candidate"}`); strings.Contains(got, "private") {
		t.Fatalf("raw candidate exposed: %q", got)
	}
	title, detail := toolResult("check_menu", map[string]any{"violations": []string{"超出预算", "设备冲突"}}, nil)
	if title != "候选方案需要调整" || !strings.Contains(detail, "2 项") {
		t.Fatalf("missing constraint result: %s %s", title, detail)
	}
	title, detail = toolResult("search_web", nil, fmt.Errorf("secret provider response"))
	if title != "工具未完成，已交回 AI 处理" || strings.Contains(detail, "secret") {
		t.Fatalf("unsafe tool failure: %s %s", title, detail)
	}
}

func TestAgentRequiresToolsAndRepairsJSON(t *testing.T) {
	requests, executions := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body struct {
			ResponseFormat map[string]string `json:"response_format"`
			Messages       []message         `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.ResponseFormat["type"] != "json_object" {
			t.Error("missing JSON mode")
		}
		m := map[string]any{"content": "{}"}
		switch requests {
		case 2:
			if !strings.Contains(body.Messages[len(body.Messages)-1].Content, "search_web") {
				t.Error("missing required-tool feedback")
			}
			m = map[string]any{"tool_calls": []any{map[string]any{"id": "search", "type": "function", "function": map[string]string{"name": "search_web", "arguments": "{}"}}}}
		case 3:
			m["content"] = "```json\n{}\n```"
		case 4:
			if !strings.Contains(body.Messages[len(body.Messages)-1].Content, "合法 JSON") {
				t.Error("missing JSON repair feedback")
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": m}}})
	}))
	defer server.Close()
	var c config.Config
	c.LLM.Enabled, c.LLM.APIKey, c.LLM.Model, c.LLM.BaseURL = true, "test", "test", server.URL
	raw, err := Agent(context.Background(), c, "JSON", "input", []Tool{{Name: "search_web", Required: true, Run: func(context.Context, json.RawMessage) (any, error) { executions++; return []any{}, nil }}}, func(string) {})
	if err != nil || string(raw) != "{}" || requests != 4 || executions != 1 {
		t.Fatalf("unexpected repair result: %s %v %d %d", raw, err, requests, executions)
	}
}
