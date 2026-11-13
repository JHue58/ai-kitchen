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

func TestAgentAlwaysSuppliesExplicitJSONInstruction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []message `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if len(body.Messages) == 0 || !strings.Contains(strings.ToLower(body.Messages[0].Content), "json") {
			http.Error(w, "messages must contain the word json for json_object", http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "{}"}}}})
	}))
	defer server.Close()
	var c config.Config
	c.LLM.Enabled, c.LLM.APIKey, c.LLM.Model, c.LLM.BaseURL = true, "test", "test", server.URL
	if _, err := Agent(context.Background(), c, "最终仅输出 {}", "为鸡蛋找图", nil, func(string) {}); err != nil {
		t.Fatal(err)
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

func TestAgentRuntimeFailuresReturnToModel(t *testing.T) {
	for _, scenario := range []string{"execution", "arguments", "serialization"} {
		t.Run(scenario, func(t *testing.T) {
			requests, executions := 0, 0
			expected := map[string]string{"execution": "upstream unavailable", "arguments": "工具参数必须是合法 JSON", "serialization": "工具结果序列化失败"}[scenario]
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				var body struct {
					Messages []message `json:"messages"`
				}
				json.NewDecoder(r.Body).Decode(&body)
				if requests == 1 {
					args := "{}"
					if scenario == "arguments" {
						args = "broken"
					}
					json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"tool_calls": []any{map[string]any{"id": "failed-call", "type": "function", "function": map[string]string{"name": "test", "arguments": args}}}}}}})
					return
				}
				last := body.Messages[len(body.Messages)-1]
				if last.Role != "tool" || last.ToolCallID != "failed-call" || !strings.Contains(last.Content, expected) {
					t.Errorf("missing failure feedback: %+v", last)
				}
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "{}"}}}})
			}))
			defer server.Close()
			var c config.Config
			c.LLM.Enabled, c.LLM.APIKey, c.LLM.Model, c.LLM.BaseURL = true, "test", "test", server.URL
			reported := false
			_, err := Agent(context.Background(), c, "system", "input", []Tool{{Name: "test", Run: func(context.Context, json.RawMessage) (any, error) {
				executions++
				if scenario == "serialization" {
					return make(chan int), nil
				}
				return nil, fmt.Errorf("upstream unavailable")
			}}}, func(string) {}, func(_, title, _ string) {
				if title == "工具未完成，已交回 AI 处理" {
					reported = true
				}
			})
			if err != nil || requests != 2 || !reported || (scenario == "arguments" && executions != 0) {
				t.Fatalf("failure was not recoverable: %v, requests=%d, reported=%v", err, requests, reported)
			}
		})
	}
}

func TestAgentPublicProgressSummary(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		m := map[string]any{"content": "{}"}
		if requests == 1 {
			m = map[string]any{"tool_calls": []any{map[string]any{"id": "summary", "type": "function", "function": map[string]string{"name": "report_progress", "arguments": `{"summary":"已确认预算，接下来检查菜单费用。"}`}}}}
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": m}}})
	}))
	defer server.Close()
	var c config.Config
	c.LLM.Enabled, c.LLM.APIKey, c.LLM.Model, c.LLM.BaseURL = true, "test", "test", server.URL
	found := false
	_, err := Agent(context.Background(), c, "system", "input", nil, func(string) {}, func(_, title, detail string) {
		if title == "AI 行动摘要" && detail == "已确认预算，接下来检查菜单费用。" {
			found = true
		}
	})
	if err != nil || !found {
		t.Fatalf("summary missing: %v", err)
	}
}
