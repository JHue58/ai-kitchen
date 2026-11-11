package handler

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"bytes"
	"encoding/json"
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
	w, _ = request("POST", "/api/v1/logout", nil, a, at)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	w, _ = request("GET", "/api/v1/me", nil, a, at)
	if w.Code != 401 {
		t.Fatal("logout failed")
	}
}
