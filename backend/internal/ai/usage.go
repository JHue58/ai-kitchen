package ai

import (
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"sync"
)

type usageKey struct{}

// UsageTracker belongs to one generation, including tool calls and repairs.
type UsageTracker struct {
	mu    sync.Mutex
	usage model.TokenUsage
}

func WithUsage(ctx context.Context, modelName string) (context.Context, *UsageTracker) {
	t := &UsageTracker{usage: model.TokenUsage{Model: modelName}}
	return context.WithValue(ctx, usageKey{}, t), t
}

func (t *UsageTracker) Snapshot() *model.TokenUsage {
	t.mu.Lock()
	defer t.mu.Unlock()
	u := t.usage
	return &u
}

func recordUsage(ctx context.Context, data []byte) {
	t, ok := ctx.Value(usageKey{}).(*UsageTracker)
	if !ok {
		return
	}
	var response struct {
		Usage *struct {
			Input  *int64 `json:"prompt_tokens"`
			Output *int64 `json:"completion_tokens"`
			Total  *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	err := json.Unmarshal(data, &response)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.usage.Calls++
	u := response.Usage
	if err != nil || u == nil || u.Input == nil || u.Output == nil || *u.Input < 0 || *u.Output < 0 {
		t.usage.MissingCalls++
		return
	}
	total := *u.Input + *u.Output
	if u.Total != nil && *u.Total >= total {
		total = *u.Total
	}
	t.usage.InputTokens += *u.Input
	t.usage.OutputTokens += *u.Output
	t.usage.TotalTokens += total
}
