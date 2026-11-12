package ai

import (
	"ai-kitchen/internal/config"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"
)

type Tool struct {
	Name        string
	Required    bool // Must be attempted before accepting a final answer.
	Description string
	Parameters  map[string]any
	Run         func(context.Context, json.RawMessage) (any, error)
}
type toolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}
type message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// Agent preserves tool-call/result history and bounds both rounds and executions.
func Agent(ctx context.Context, c config.Config, system, input string, available []Tool, progress func(string), observers ...func(string, string, string)) (output []byte, runErr error) {
	started := time.Now()
	logger := Logger(ctx)
	logger.Info("agent.started", "model", c.LLM.Model)
	defer func() {
		if runErr != nil {
			logger.Error("agent.failed", "error", runErr)
		}
		logger.Info("agent.finished", "duration", time.Since(started))
	}()
	if !c.LLM.Enabled || c.LLM.APIKey == "" || c.LLM.Model == "" {
		return nil, fmt.Errorf("尚未配置 AI 服务")
	}
	messages := []message{{Role: "system", Content: system}, {Role: "user", Content: input}}
	available = append(append([]Tool{}, available...), Tool{
		Name: "report_progress", Description: "向用户展示简短的行动摘要：当前要做什么、已知结果及下一步。不要输出内部推理、敏感信息或原始响应。",
		Parameters: map[string]any{"type": "object", "properties": map[string]any{"summary": map[string]any{"type": "string", "maxLength": 600}}, "required": []string{"summary"}, "additionalProperties": false},
		Run: func(_ context.Context, args json.RawMessage) (any, error) {
			var value struct {
				Summary string `json:"summary"`
			}
			if err := json.Unmarshal(args, &value); err != nil {
				return nil, err
			}
			value.Summary = strings.TrimSpace(value.Summary)
			if value.Summary == "" || len([]rune(value.Summary)) > 600 {
				return nil, fmt.Errorf("行动摘要应为 1 至 600 字")
			}
			return value.Summary, nil
		},
	})
	specs := []any{}
	registry := map[string]Tool{}
	for _, t := range available {
		registry[t.Name] = t
		specs = append(specs, map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters}})
	}
	report := func(status, title, detail string) {
		if len(observers) > 0 {
			observers[0](status, title, detail)
		} else {
			progress(status)
		}
	}
	calls := 0
	attempted := map[string]bool{}
	finalRepairs := 0
	for round := 0; round < 32; round++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		logger.Info("agent.round.started", "round", round+1, "messages", len(messages))
		report("planning", fmt.Sprintf("正在规划 · 第 %d 轮", round+1), "结合厨房条件和已有工具结果，等待模型返回下一步操作")
		args := map[string]any{"model": c.LLM.Model, "messages": messages, "tools": specs, "tool_choice": "auto"}
		args["response_format"] = map[string]string{"type": "json_object"}
		if c.LLM.MaxTokens > 0 {
			args["max_tokens"] = c.LLM.MaxTokens
		}
		var out struct {
			Choices []struct {
				Message      message `json:"message"`
				FinishReason string  `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := Post(ctx, c.LLM.BaseURL, "/chat/completions", c.LLM.APIKey, args, &out); err != nil {
			return nil, err
		}
		if len(out.Choices) == 0 {
			return nil, fmt.Errorf("模型未返回内容")
		}
		m := out.Choices[0].Message
		m.Role = "assistant"
		messages = append(messages, m)
		if len(m.ToolCalls) == 0 {
			missing := []string{}
			for _, t := range available {
				if t.Required && !attempted[t.Name] {
					missing = append(missing, t.Name)
				}
			}
			problem := ""
			if len(missing) > 0 {
				problem = "请先实际调用必需工具：" + strings.Join(missing, "、")
			} else if out.Choices[0].FinishReason == "length" {
				problem = "上次输出被 token 上限截断，请精简文字，保留完整字段，重新输出完整 JSON 对象。"
			} else if !json.Valid([]byte(m.Content)) || !strings.HasPrefix(strings.TrimSpace(m.Content), "{") {
				problem = "上次回答不是合法 JSON 对象。请修正语法，仅输出一个完整 JSON 对象，不要代码围栏或解释。"
			}
			if problem != "" {
				if finalRepairs >= 2 {
					return nil, fmt.Errorf("模型未满足输出要求：%s", problem)
				}
				finalRepairs++
				messages = append(messages, message{Role: "user", Content: problem})
				continue
			}
			return []byte(m.Content), nil
		}
		for _, call := range m.ToolCalls {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			calls++
			toolStarted := time.Now()
			logger.Info("agent.tool.started", "tool", call.Function.Name, "tool_call_id", call.ID)
			if calls > 64 {
				return nil, fmt.Errorf("Agent 工具调用次数达到上限，请简化需求后重试")
			}
			var result any
			var err error
			t, ok := registry[call.Function.Name]
			if !ok {
				err = fmt.Errorf("工具不可用")
			} else if !json.Valid([]byte(call.Function.Arguments)) {
				err = fmt.Errorf("工具参数必须是合法 JSON")
			} else {
				attempted[call.Function.Name] = true
				if call.Function.Name != "report_progress" {
					report(call.Function.Name, toolTitle(call.Function.Name), toolDetail(call.Function.Name, call.Function.Arguments))
				}
				result, err = t.Run(ctx, json.RawMessage(call.Function.Arguments))
			}
			b, marshalErr := json.Marshal(result)
			if err == nil && marshalErr != nil {
				err = fmt.Errorf("工具结果序列化失败：%w", marshalErr)
			}
			title, detail := toolResult(call.Function.Name, result, err)
			report(call.Function.Name, title, detail)
			if err != nil {
				logger.Error("agent.tool.failed", "tool", call.Function.Name, "tool_call_id", call.ID, "error", err)
				b, _ = json.Marshal(map[string]string{"error": err.Error()})
			}
			logger.Info("agent.tool.finished", "tool", call.Function.Name, "duration", time.Since(toolStarted))
			messages = append(messages, message{Role: "tool", ToolCallID: call.ID, Content: string(b)})
		}
	}
	return nil, fmt.Errorf("Agent 规划轮次达到上限，请简化需求后重试")
}

// Expose public action summaries and tool activity, never internal reasoning.
func toolTitle(name string) string {
	switch name {
	case "search_existing_dishes":
		return "正在搜索我的历史菜品与菜单"
	case "search_web":
		return "正在搜索网页资料"
	case "view_image":
		return "正在检查图片内容与清晰度"
	case "fetch_page":
		return "正在阅读参考网页"
	case "check_menu":
		return "正在核算候选方案"
	default:
		return "正在执行工具"
	}
}
func toolDetail(name, args string) string {
	var values map[string]any
	if json.Unmarshal([]byte(args), &values) != nil {
		return ""
	}
	if name == "search_web" {
		query, _ := values["query"].(string)
		runes := []rune(strings.TrimSpace(query))
		if len(runes) > 160 {
			runes = runes[:160]
		}
		return string(runes)
	}
	if name == "fetch_page" || name == "view_image" {
		raw, _ := values["url"].(string)
		u, err := url.Parse(raw)
		if err == nil {
			return u.Hostname()
		}
	}
	if name == "check_menu" {
		return "检查食材、预算、营养、设备和烹饪时间安排"
	}
	return ""
}
func toolResult(name string, result any, err error) (string, string) {
	if err != nil {
		return "工具未完成，已交回 AI 处理", "AI 将根据工具失败结果调整方案"
	}
	if name == "report_progress" {
		summary, _ := result.(string)
		return "AI 行动摘要", summary
	}
	if name == "search_existing_dishes" {
		if data, ok := result.(map[string]any); ok {
			return "历史菜品搜索完成", fmt.Sprintf("找到 %v 道符合筛选条件的菜品，AI 将检查能否复用", data["total"])
		}
	}
	if name == "check_menu" {
		if data, ok := result.(map[string]any); ok {
			if violations, ok := data["violations"].([]string); ok && len(violations) > 0 {
				return "候选方案需要调整", fmt.Sprintf("发现 %d 项约束问题：%s", len(violations), strings.Join(violations, "；"))
			}
		}
		return "候选方案核算完成", "已将费用、营养与约束检查结果交给 AI"
	}
	if name == "search_web" {
		return "网页搜索完成", "网页资料已返回，继续分析"
	}
	if name == "view_image" {
		return "图片识别完成", "菜品匹配度与清晰度判断已交给 AI"
	}
	return "参考网页读取完成", "正文已交给 AI，用于完善食材用量与步骤"
}

type loggerKey struct{}

func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, logger)
}
func Logger(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}
