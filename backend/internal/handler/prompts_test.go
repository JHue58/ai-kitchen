package handler

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"ai-kitchen/internal/service"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGlobalPromptSettings(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	db, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	t.Cleanup(func() { sql.Close() })
	router := (&Server{DB: db, C: cfg}).Router()
	for _, u := range []model.User{{ID: 1, Username: "admin", Admin: true}, {ID: 2, Username: "alice"}, {ID: 3, Username: "bob"}} {
		db.Create(&u)
		db.Create(&model.Session{ID: digest(fmt.Sprint(u.ID)), UserID: u.ID, CSRF: "csrf", ExpiresAt: time.Now().Add(time.Hour)})
	}
	request := func(user uint, method, path string, body any, status int) []byte {
		t.Helper()
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(b))
		r.Header.Set("Cookie", fmt.Sprintf("kitchen_session=%d", user))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", "csrf")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
		}
		return w.Body.Bytes()
	}
	request(1, "GET", "/admin/global-prompt", nil, 200)
	for _, method := range []string{"GET", "PUT"} {
		request(2, method, "/admin/global-prompt", map[string]string{"global_prompt": "禁止修改"}, 403)
	}
	request(1, "PUT", "/admin/global-prompt", map[string]string{"global_prompt": "所有用户优先时令菜"}, 200)
	request(1, "PUT", "/admin/global-prompt", map[string]any{}, 400)
	request(1, "PUT", "/admin/global-prompt", map[string]any{"global_prompt": nil}, 400)
	request(1, "PUT", "/admin/global-prompt", map[string]string{"global_prompt": strings.Repeat("字", 10001)}, 400)
	for _, user := range []uint{2, 3} {
		request(user, "POST", "/documents/preferences", map[string]any{"theme": "light", "global_prompt": fmt.Sprintf("个人%d", user)}, 200)
	}
	request(2, "POST", "/documents/preferences", map[string]any{"theme": "light", "global_prompt": strings.Repeat("字", 10001)}, 400)
	for _, user := range []uint{2, 3} {
		body := request(user, "GET", "/documents/preferences", nil, 200)
		if !bytes.Contains(body, []byte(fmt.Sprintf("个人%d", user))) || bytes.Contains(body, []byte(fmt.Sprintf("个人%d", 5-user))) {
			t.Fatalf("personal prompt isolation: %s", body)
		}
	}
	var alice model.Document
	db.First(&alice, "user_id = ? AND kind = ?", 2, "preferences")
	request(3, "PUT", fmt.Sprintf("/documents/preferences/%d", alice.ID), map[string]any{"theme": "light", "global_prompt": "篡改"}, 404)
	db2, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sql2, _ := db2.DB()
	defer sql2.Close()
	if prompt, err := service.GlobalPrompt(db2); err != nil || prompt != "所有用户优先时令菜" {
		t.Fatalf("not persisted: %q %v", prompt, err)
	}
	request(1, "PUT", "/admin/global-prompt", map[string]string{"global_prompt": ""}, 200)
	if prompt, err := service.GlobalPrompt(db); err != nil || prompt != "" {
		t.Fatalf("not cleared: %q %v", prompt, err)
	}
	request(2, "PUT", fmt.Sprintf("/documents/preferences/%d", alice.ID), map[string]any{"theme": "light", "global_prompt": ""}, 200)
	if service.Prefs(db, 2).GlobalPrompt != "" {
		t.Fatal("personal prompt not cleared")
	}
}
