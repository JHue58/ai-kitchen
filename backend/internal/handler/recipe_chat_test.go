package handler

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestRecipeChatEndpointsAuthorizeAndCleanUpHistory(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "chat.db")
	cfg.Auth.AllowRegistration = true
	cfg.Auth.SessionTTLHours = 24
	cfg.LLM.Enabled = true
	cfg.LLM.APIKey = "test"
	cfg.LLM.Model = "test-agent"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": `{"reply":"切成小块即可。","updated":false}`}}}})
	}))
	defer upstream.Close()
	cfg.LLM.BaseURL = upstream.URL
	db, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	router := (&Server{DB: db, C: cfg}).Router()
	request := func(method, path string, body any, cookie *http.Cookie, csrf string) (*httptest.ResponseRecorder, map[string]any) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		req.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return w, out
	}
	register := func(name string) (*http.Cookie, string, uint) {
		w, out := request("POST", "/api/v1/register", map[string]string{"username": name, "password": "test-password-123"}, nil, "")
		if w.Code != 200 {
			t.Fatalf("register %d: %s", w.Code, w.Body)
		}
		return w.Result().Cookies()[0], out["csrf"].(string), uint(out["user"].(map[string]any)["id"].(float64))
	}
	alice, aliceCSRF, aliceID := register("alice")
	bob, bobCSRF, bobID := register("bob")
	data := `{"name":"煎豆腐","servings":2,"ingredients":[{"name":"豆腐","category":"main","quantity":200,"unit":"g"}],"steps":[{"step":1,"title":"煎熟","description":"小火煎熟","duration_minutes":5}],"equipment":[],"energy_usage":[]}`
	doc := model.Document{UserID: aliceID, Kind: "dishes", Data: data}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/v1/documents/dishes/%d/chat?visit_id=alice-page", doc.ID)
	for _, test := range []struct {
		method string
		cookie *http.Cookie
		csrf   string
		body   any
		want   int
	}{
		{"GET", nil, "", nil, 401},
		{"GET", bob, "", nil, 404},
		{"POST", bob, bobCSRF, map[string]string{"message": "怎么切"}, 404},
		{"POST", alice, "", map[string]string{"message": "怎么切"}, 403},
		{"DELETE", bob, bobCSRF, nil, 404},
		{"DELETE", alice, "", nil, 403},
		{"POST", alice, aliceCSRF, map[string]string{"message": "  "}, 400},
		{"GET", alice, "", nil, 200},
		{"POST", alice, aliceCSRF, map[string]string{"message": "怎么切", "request_id": "first"}, 200},
	} {
		w, _ := request(test.method, path, test.body, test.cookie, test.csrf)
		if w.Code != test.want {
			t.Fatalf("%s expected %d got %d: %s", test.method, test.want, w.Code, w.Body)
		}
	}
	w, out := request("GET", path, nil, alice, "")
	if w.Code != 200 || len(out["messages"].([]any)) != 2 || out["document"].(map[string]any)["id"] != float64(doc.ID) {
		t.Fatal("history or document missing", w.Body)
	}
	w, _ = request("DELETE", path, nil, alice, aliceCSRF)
	if w.Code != 200 {
		t.Fatal("clear page conversation", w.Body)
	}
	w, _ = request("GET", path, nil, alice, "")
	if w.Code != 410 {
		t.Fatal("closed visit reopened", w.Body)
	}
	newPath := fmt.Sprintf("/api/v1/documents/dishes/%d/chat?visit_id=alice-next-page", doc.ID)
	w, out = request("GET", newPath, nil, alice, "")
	if w.Code != 200 || len(out["messages"].([]any)) != 0 {
		t.Fatal("next page inherited history", w.Body)
	}

	// Disconnecting the browser must not cancel accepted AI work.
	raw, _ := json.Marshal(map[string]string{"message": "怎么切", "request_id": "disconnected"})
	req := httptest.NewRequest("POST", newPath, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", aliceCSRF)
	req.AddCookie(alice)
	disconnected, cancel := context.WithCancel(req.Context())
	req = req.WithContext(disconnected)
	cancel()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatal("browser disconnect canceled accepted task", response.Body)
	}
	w, out = request("GET", newPath, nil, alice, "")
	if w.Code != 200 || len(out["messages"].([]any)) != 2 {
		t.Fatal("disconnected task result not recoverable", w.Body)
	}
	w, _ = request("DELETE", fmt.Sprintf("/api/v1/documents/dishes/%d", doc.ID), nil, alice, aliceCSRF)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	var count int64
	db.Model(&model.RecipeChat{}).Where("document_id = ?", doc.ID).Count(&count)
	if count != 0 {
		t.Fatal("deleted document retained chat history")
	}
	w, _ = request("GET", path, nil, alice, "")
	if w.Code != 404 {
		t.Fatal("deleted document chat accessible")
	}
	// User deletion also removes conversations independently of document kind.
	doc = model.Document{UserID: bobID, Kind: "dishes", Data: data}
	db.Create(&doc)
	bobPath := fmt.Sprintf("/api/v1/documents/dishes/%d/chat?visit_id=bob-page", doc.ID)
	w, _ = request("GET", bobPath, nil, bob, "")
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	db.Model(&model.User{}).Where("id = ?", aliceID).Update("admin", true)
	w, _ = request("DELETE", fmt.Sprintf("/api/v1/admin/users/%d", bobID), nil, alice, aliceCSRF)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	db.Model(&model.RecipeChat{}).Where("user_id = ?", bobID).Count(&count)
	if count != 0 {
		t.Fatal("deleted user retained chat history")
	}
}
