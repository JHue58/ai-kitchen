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
	for round := 0; round < 12; round++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		logger.Info("agent.round.started", "round", round+1, "messages", len(messages))
		report("planning", fmt.Sprintf("正在规划 · 第 %d 轮", round+1), "结合厨房条件和已有工具结果，等待模型返回下一步操作")
		args := map[string]any{"model": c.LLM.Model, "temperature": c.LLM.Temperature, "messages": messages, "tools": specs, "tool_choice": "auto"}
		if c.LLM.MaxTokens > 0 {
			args["max_tokens"] = c.LLM.MaxTokens
		}
		var out struct {
			Choices []struct {
				Message message `json:"message"`
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
			return []byte(m.Content), nil
		}
		for _, call := range m.ToolCalls {
			calls++
			toolStarted := time.Now()
			logger.Info("agent.tool.started", "tool", call.Function.Name, "tool_call_id", call.ID)
			if calls > 24 {
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
				report(call.Function.Name, toolTitle(call.Function.Name), toolDetail(call.Function.Name, call.Function.Arguments))
				result, err = t.Run(ctx, json.RawMessage(call.Function.Arguments))
				title, detail := toolResult(call.Function.Name, result, err)
				report(call.Function.Name, title, detail)
			}
			if err != nil {
				logger.Error("agent.tool.failed", "tool", call.Function.Name, "tool_call_id", call.ID, "error", err)
				result = map[string]string{"error": err.Error()}
			}
			logger.Info("agent.tool.finished", "tool", call.Function.Name, "duration", time.Since(toolStarted))
			b, _ := json.Marshal(result)
			messages = append(messages, message{Role: "tool", ToolCallID: call.ID, Content: string(b)})
		}
	}
	return nil, fmt.Errorf("Agent 规划轮次达到上限，请简化需求后重试")
}

// Only expose concise tool activity, never model reasoning or raw tool payloads.
func toolTitle(name string) string {
	switch name {
	case "search_web":
		return "正在搜索网页与图片"
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
	if name == "check_menu" {
		if data, ok := result.(map[string]any); ok {
			if violations, ok := data["violations"].([]string); ok && len(violations) > 0 {
				return "候选方案需要调整", fmt.Sprintf("发现 %d 项约束问题：%s", len(violations), strings.Join(violations, "；"))
			}
		}
		return "候选方案核算完成", "已将费用、营养与约束检查结果交给 AI"
	}
	if name == "search_web" {
		return "网页搜索完成", "网页及图片候选已返回，继续分析"
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
