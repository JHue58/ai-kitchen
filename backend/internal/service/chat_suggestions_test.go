package service

import (
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestChatSuggestionsRefreshWithoutClaimingRecipeChanges(t *testing.T) {
	db, c, doc, original := chatFixture(t)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		answer := map[string]any{"reply": "小火慢煎即可。", "updated": false}
		if calls == 1 {
			answer["chat_suggestions"] = []model.ChatSuggestion{{Label: "鸡蛋嫩一些", Message: "鸡蛋怎样煎得更嫩？"}, {Label: "鸡蛋嫩一些", Message: "重复按钮"}, {Label: "", Message: "无标题"}}
		}
		if calls == 3 {
			answer["chat_suggestions"] = []model.ChatSuggestion{}
		}
		raw, _ := json.Marshal(answer)
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}}})
	}))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	for turn := 1; turn <= 3; turn++ {
		reply, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "讲讲火候，先别修改菜谱")
		if err != nil {
			t.Fatal(err)
		}
		if len(reply.ChangedSections) != 0 {
			t.Fatal("suggestion refresh claimed a recipe edit", reply.ChangedSections)
		}
		suggestions := reply.Document["chat_suggestions"].([]any)
		expected := 1
		if turn == 3 {
			expected = 0
		}
		if len(suggestions) != expected {
			t.Fatal("suggestions not refreshed, retained or explicitly cleared", turn, suggestions)
		}
		if !reflect.DeepEqual(original["dishes"], reply.Document["dishes"]) {
			t.Fatal("suggestions changed recipe content")
		}
	}
	recovered, err := GetRecipeChat(db, 1, "recipes", doc.ID)
	if err != nil || len(recovered.Document["chat_suggestions"].([]any)) != 0 {
		t.Fatal("suggestions not persisted", err)
	}
}

func TestChangedDishInvalidatesStaleSuggestionsAndAcceptsNewOnes(t *testing.T) {
	db, _, _, original := chatFixture(t)
	original["chat_suggestions"] = []any{map[string]any{"label": "换牛肉", "message": "牛肉可以换成什么？"}}
	original["dishes"].([]any)[1].(map[string]any)["chat_suggestions"] = original["chat_suggestions"]
	changes, err := newRecipeChanges(db, 1, "recipes", original)
	if err != nil {
		t.Fatal(err)
	}
	patch := secondDishChange(original)
	raw, _ := json.Marshal(patch)
	if _, err := changes.apply(raw); err != nil {
		t.Fatal(err)
	}
	dish := changes.current["dishes"].([]any)[1].(map[string]any)
	if len(dish["chat_suggestions"].([]any)) != 0 {
		t.Fatal("stale beef suggestions survived replacement")
	}
	patch = map[string]any{"menu_changes": map[string]any{}, "dish_updates": []any{map[string]any{"index": 1, "changes": map[string]any{"chat_suggestions": []model.ChatSuggestion{{Label: "鸡胸不柴", Message: "怎样让鸡胸肉不柴？"}}}}}}
	raw, _ = json.Marshal(patch)
	if _, err := changes.apply(raw); err != nil {
		t.Fatal(err)
	}
	if changes.current["dishes"].([]any)[1].(map[string]any)["chat_suggestions"].([]any)[0].(map[string]any)["label"] != "鸡胸不柴" {
		t.Fatal("new dish suggestions lost")
	}
}
