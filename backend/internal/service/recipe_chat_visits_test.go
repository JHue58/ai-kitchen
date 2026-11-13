package service

import (
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRecipeChatPageVisitsAreIndependentAndClosingErasesHistory(t *testing.T) {
	db, c, doc, _ := chatFixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { answerJSON(w, "小火煎至熟透即可。", false) }))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	if _, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "怎么煎", "a1", "visit-a"); err != nil {
		t.Fatal(err)
	}
	a, err := GetRecipeChat(db, 1, "recipes", doc.ID, "visit-a")
	if err != nil || len(a.Messages) != 2 {
		t.Fatal("same page lost history", a, err)
	}
	b, err := GetRecipeChat(db, 1, "recipes", doc.ID, "visit-b")
	if err != nil || len(b.Messages) != 0 || a.SessionID == b.SessionID {
		t.Fatal("page visits shared transcript", b, err)
	}
	if err := CloseRecipeChat(db, 1, "recipes", doc.ID, "visit-a"); err != nil {
		t.Fatal(err)
	}
	var closed model.RecipeChat
	db.First(&closed, a.SessionID)
	if closed.ClosedAt == nil || len(closed.Messages) != 0 || closed.LockToken != "" {
		t.Fatal("history retained after leaving", closed)
	}
	if _, err := GetRecipeChat(db, 1, "recipes", doc.ID, "visit-a"); !errors.Is(err, ErrChatClosed) {
		t.Fatal("closed visit reopened", err)
	}
	if _, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "再问", "a2", "visit-a"); !errors.Is(err, ErrChatClosed) {
		t.Fatal("late message recreated visit", err)
	}
	if _, err := GetRecipeChat(db, 1, "recipes", doc.ID, "visit-b"); err != nil {
		t.Fatal("closing one page broke another", err)
	}
	next, err := GetRecipeChat(db, 1, "recipes", doc.ID, "visit-next")
	if err != nil || len(next.Messages) != 0 {
		t.Fatal("new page inherited transcript", err)
	}
}

func TestRecipeChatCloseTombstoneRejectsDelayedOpenAndCleansStaleVisits(t *testing.T) {
	db, _, doc, _ := chatFixture(t)
	if err := CloseRecipeChat(db, 1, "recipes", doc.ID, "unopened"); err != nil {
		t.Fatal(err)
	}
	if _, err := GetRecipeChat(db, 1, "recipes", doc.ID, "unopened"); !errors.Is(err, ErrChatClosed) {
		t.Fatal("delayed GET resurrected closed visit", err)
	}
	stale := model.RecipeChat{UserID: 1, Kind: "recipes", DocumentID: doc.ID, VisitID: "crashed-tab", Messages: []model.ChatMessage{{ID: "private", Role: "user", Content: "stale transcript"}}}
	if err := db.Create(&stale).Error; err != nil {
		t.Fatal(err)
	}
	db.Model(&stale).UpdateColumn("updated_at", time.Now().Add(-25*time.Hour))
	if _, err := GetRecipeChat(db, 1, "recipes", doc.ID, "new-tab"); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.RecipeChat{}).Where("id = ?", stale.ID).Count(&count)
	if count != 0 {
		t.Fatal("missed unload retained stale history forever")
	}
}

func TestRecipeChatClosingDuringAgentPreventsLateWriteback(t *testing.T) {
	db, c, doc, original := chatFixture(t)
	reached, release := make(chan struct{}), make(chan struct{})
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			callChatTool(w, secondDishChange(original))
			return
		}
		close(reached)
		<-release
		answerJSON(w, "第二道已换好。", true)
	}))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	result := make(chan error, 1)
	go func() {
		_, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "只换第二道", "request", "leaving-page")
		result <- err
	}()
	select {
	case <-reached:
	case <-time.After(5 * time.Second):
		t.Fatal("agent did not reach pending reply")
	}
	if err := CloseRecipeChat(db, 1, "recipes", doc.ID, "leaving-page"); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-result; !errors.Is(err, ErrChatClosed) {
		t.Fatal("closed page allowed writeback", err)
	}
	var latest model.Document
	db.First(&latest, doc.ID)
	if latest.Data != doc.Data {
		t.Fatal("late Agent reply modified recipe after leaving")
	}
	var chat model.RecipeChat
	db.Where("visit_id = ?", "leaving-page").First(&chat)
	if len(chat.Messages) != 0 || chat.ClosedAt == nil {
		t.Fatal("late Agent reply resurrected transcript")
	}
}

func TestRecipeChatDislikeIsDirectEditAuthorization(t *testing.T) {
	db, c, doc, original := chatFixture(t)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request map[string]any
		json.NewDecoder(r.Body).Decode(&request)
		if calls == 1 {
			messages := request["messages"].([]any)
			system := messages[0].(map[string]any)["content"].(string)
			for _, rule := range []string{"不是很想吃西兰花啊", "调整授权", "不要回复", "明确说“只问一下、先别改菜谱”时不得修改"} {
				if !strings.Contains(system, rule) {
					t.Errorf("missing direct execution rule %q", rule)
				}
			}
			callChatTool(w, secondDishChange(original))
			return
		}
		answerJSON(w, "第二道换成香煎鸡胸肉，另外两道保留。", true)
	}))
	defer upstream.Close()
	c.LLM.BaseURL = upstream.URL
	result, err := ReplyRecipeChat(context.Background(), db, c, 1, "recipes", doc.ID, "不太想吃牛肉了", "dislike", "page")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(result.Messages) != 2 || !containsSection(result.ChangedSections, "dish-1") {
		t.Fatal("dislike required an extra confirmation turn", result, calls)
	}
}
