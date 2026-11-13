package handler

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestAuthenticationIsolationAndPersistence(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	cfg.Auth.AllowRegistration = true
	cfg.Auth.SessionTTLHours = 24
	db, e := repository.Open(cfg)
	if e != nil {
		t.Fatal(e)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	router := (&Server{DB: db, C: cfg}).Router()
	request := func(method, path string, body any, cookie *http.Cookie, csrf string) (*httptest.ResponseRecorder, map[string]any) {
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return w, out
	}
	register := func(name string) (*http.Cookie, string) {
		w, r := request("POST", "/api/v1/register", map[string]string{"username": name, "password": "test-password-123"}, nil, "")
		if w.Code != 200 {
			t.Fatalf("register %d: %s", w.Code, w.Body)
		}
		return w.Result().Cookies()[0], r["csrf"].(string)
	}
	a, at := register("alice")
	b, bt := register("bob")
	w, doc := request("POST", "/api/v1/documents/equipment", map[string]any{"name": "炒锅", "electric": false}, a, at)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	id := doc["id"].(float64)
	var d model.Document
	db.First(&d, uint(id))
	if d.UserID == 0 {
		t.Fatal("missing owner")
	}
	for _, method := range []string{"PUT", "DELETE"} {
		w, _ = request(method, "/api/v1/documents/equipment/1", map[string]string{"name": "stolen"}, b, bt)
		if w.Code != 404 {
			t.Fatalf("cross-user %s allowed", method)
		}
	}
	w, _ = request("POST", "/api/v1/documents/equipment", map[string]string{"name": "CSRF"}, a, "")
	if w.Code != 403 {
		t.Fatal("CSRF accepted")
	}
	w, _ = request("GET", "/api/v1/admin/users", nil, b, bt)
	if w.Code != 403 {
		t.Fatal("admin escalation")
	}
	w, _ = request("GET", "/api/v1/documents/equipment", nil, nil, "")
	if w.Code != 401 {
		t.Fatal("unauthorized accepted")
	}
	db2, e := repository.Open(cfg)
	if e != nil {
		t.Fatal(e)
	}
	sqlDB2, _ := db2.DB()
	t.Cleanup(func() { sqlDB2.Close() })
	var persisted model.Document
	if db2.First(&persisted, uint(id)).Error != nil || persisted.Data != d.Data {
		t.Fatal("persistence failed")
	}

	menu := map[string]any{"title": "测试菜单", "servings": 2, "tags": []string{"家常菜"}, "dishes": []any{map[string]any{"name": "鸡蛋", "ingredients": []any{map[string]any{"name": "鸡蛋", "quantity": 2, "unit": "个"}}, "steps": []any{map[string]any{"description": "充分加热", "duration_minutes": 5}}}}}
	w, created := request("POST", "/api/v1/documents/recipes", menu, a, at)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	menuID := uint(created["id"].(float64))
	var autoDishes []model.Document
	db.Where("user_id = ? AND kind = ?", d.UserID, "dishes").Find(&autoDishes)
	if len(autoDishes) != 1 {
		t.Fatal("menu creation did not automatically collect its dish")
	}
	w, saved := request("POST", fmt.Sprintf("/api/v1/recipes/%d/dishes/0", menuID), nil, a, at)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	dishID := uint(saved["id"].(float64))
	if dishID != autoDishes[0].ID || saved["saved"] != true {
		t.Fatal("manual save duplicated auto-collected dish or omitted feedback")
	}
	for i := 0; i < 3; i++ {
		w, again := request("POST", fmt.Sprintf("/api/v1/recipes/%d/dishes/0", menuID), nil, a, at)
		if w.Code != 200 || again["id"] != saved["id"] || again["already_saved"] != true {
			t.Fatalf("save is not idempotent: %s", w.Body)
		}
	}
	w, _ = request("POST", fmt.Sprintf("/api/v1/recipes/%d/dishes/0", menuID), nil, b, bt)
	if w.Code != 404 {
		t.Fatal("cross-owner extraction allowed")
	}
	w, _ = request("GET", "/api/v1/documents/recipes?tag=家常菜&servings=2&min_cost=0", nil, a, at)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("测试菜单")) {
		t.Fatal(w.Body)
	}
	w, _ = request("GET", "/api/v1/documents/recipes?servings=3", nil, a, at)
	if w.Body.String() != "[]" {
		t.Fatal("servings filter failed", w.Body)
	}
	w, _ = request("DELETE", fmt.Sprintf("/api/v1/documents/recipes/%d", menuID), nil, a, at)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	var independent model.Document
	if db.First(&independent, dishID).Error != nil || independent.Kind != "dishes" {
		t.Fatal("menu deletion removed dish")
	}
	w, _ = request("GET", "/api/v1/documents/dishes?saved=true&q=鸡蛋", nil, a, at)
	if !bytes.Contains(w.Body.Bytes(), []byte("鸡蛋")) {
		t.Fatal(w.Body)
	}
	w, _ = request("GET", "/api/v1/documents/dishes", nil, b, bt)
	if w.Body.String() != "[]" {
		t.Fatal("cross-user collection leaked", w.Body)
	}
	w, _ = request("POST", "/api/v1/logout", nil, a, at)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	w, _ = request("GET", "/api/v1/me", nil, a, at)
	if w.Code != 401 {
		t.Fatal("logout failed")
	}
}
