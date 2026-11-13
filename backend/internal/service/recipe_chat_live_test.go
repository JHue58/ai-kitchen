package service

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

// Explicitly opt in: this test calls the configured model, but uses an isolated
// temporary database and synthetic food data. Normal go test never makes paid calls.
func TestLiveRecipeChatDislikeEditsImmediately(t *testing.T) {
	if os.Getenv("KITCHEN_RUN_LIVE_CHAT_TEST") != "1" {
		t.Skip("live model test requires explicit opt-in")
	}
	actual, err := config.Load("../../../config.yaml")
	if err != nil {
		t.Fatal("cannot load local model configuration")
	}
	if !actual.LLM.Enabled || actual.LLM.APIKey == "" || actual.LLM.Model == "" {
		t.Skip("no enabled model is configured")
	}
	actual.Search.Enabled = false
	actual.LLM.TimeoutSeconds = 60
	actual.LLM.MaxTokens = 4000
	db, _, doc, original := chatFixture(t)
	dishes := original["dishes"].([]any)
	first := dishes[0].(map[string]any)
	first["name"] = "清炒西兰花"
	first["description"] = "西兰花焯水后快炒，清淡鲜脆。"
	first["ingredients"].([]any)[0].(map[string]any)["name"] = "西兰花"
	first["steps"].([]any)[0].(map[string]any)["description"] = "西兰花焯水后小火翻炒至熟。"
	raw, _ := json.Marshal(original)
	if err := db.Model(&model.Document{}).Where("id = ?", doc.ID).Update("data", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := ReplyRecipeChat(ctx, db, actual, 1, "recipes", doc.ID, "不是很想吃西兰花啊", "live-dislike", "live-visit")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ChangedSections) == 0 {
		t.Fatal("model asked or advised instead of applying the requested preference")
	}
	updated := result.Document["dishes"].([]any)
	for _, item := range updated[0].(map[string]any)["ingredients"].([]any) {
		if item.(map[string]any)["name"] == "西兰花" {
			t.Fatal("disliked ingredient remains in the edited dish")
		}
	}
	for index := 1; index < len(dishes); index++ {
		if !reflect.DeepEqual(updated[index], dishes[index]) {
			t.Fatal("model changed an unrelated dish")
		}
	}
	state, err := GetRecipeChat(db, 1, "recipes", doc.ID, "live-visit")
	if err != nil || len(state.Messages) != 2 {
		t.Fatal("expected a single user turn and a completed assistant turn")
	}
}
