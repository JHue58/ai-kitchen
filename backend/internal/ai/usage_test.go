package ai

import (
	"context"
	"testing"
)

func TestUsageTracksRoundsAndMissingReports(t *testing.T) {
	ctx, tracker := WithUsage(context.Background(), "test-model")
	for _, response := range []string{
		`{"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}`,
		`{"usage":{"prompt_tokens":30,"completion_tokens":5}}`,
		`{"usage":null}`,
		`{"usage":{}}`,
	} {
		recordUsage(ctx, []byte(response))
	}
	u := tracker.Snapshot()
	if u.InputTokens != 130 || u.OutputTokens != 25 || u.TotalTokens != 155 || u.Calls != 4 || u.MissingCalls != 2 || u.Model != "test-model" {
		t.Fatalf("unexpected usage: %+v", u)
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	recordUsage(child, []byte(`{"usage":{"prompt_tokens":10,"completion_tokens":2}}`))
	if tracker.Snapshot().TotalTokens != 167 || u.TotalTokens != 155 {
		t.Fatal("child contexts must share tracking, snapshots must be independent")
	}
	_, other := WithUsage(context.Background(), "other")
	if other.Snapshot().Calls != 0 {
		t.Fatal("usage leaked between jobs")
	}
}
