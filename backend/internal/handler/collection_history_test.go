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
	"time"
)

func TestCollectionOrderingMetadataAndDirectOwnership(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "collections.db")
	db, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	user := model.User{Username: "alice"}
	db.Create(&user)
	db.Create(&model.Session{ID: digest("token"), UserID: user.ID, CSRF: "csrf", ExpiresAt: time.Now().Add(time.Hour)})
	router := (&Server{DB: db, C: cfg}).Router()
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.AddCookie(&http.Cookie{Name: "kitchen_session", Value: "token"})
		r.Header.Set("X-CSRF-Token", "csrf")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	base := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	makeDoc := func(index int) model.Document {
		menu := model.Recipe{Title: fmt.Sprintf("menu-%02d", index), Servings: 2, Saved: true, Favorite: true, Dishes: []model.Dish{{Name: "炒蛋", Ingredients: []model.Ingredient{{Name: "鸡蛋", Quantity: 2, Unit: "个"}}, Steps: []model.Step{{Description: "炒熟"}}}}}
		raw, _ := json.Marshal(menu)
		created := base.Add(time.Duration(index) * time.Hour)
		saved := base.Add(time.Duration(60-index) * time.Hour)
		favorite := base.Add(time.Duration(index) * time.Minute)
		doc := model.Document{UserID: user.ID, Kind: "recipes", Data: string(raw), CreatedAt: created, SavedAt: &saved, FavoritedAt: &favorite}
		if err := db.Create(&doc).Error; err != nil {
			t.Fatal(err)
		}
		return doc
	}
	docs := []model.Document{}
	for i := 0; i < 60; i++ {
		docs = append(docs, makeDoc(i))
	}
	list := func(query string) []map[string]any {
		w := request("GET", "/api/v1/documents/recipes"+query, nil)
		if w.Code != 200 {
			t.Fatalf("list %d %s", w.Code, w.Body)
		}
		var rows []map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}
	all := list("")
	if len(all) != 60 || all[0]["id"] != float64(docs[59].ID) {
		t.Fatal("generation chronology wrong")
	}
	recent := list("?recent=true")
	if len(recent) != 50 || recent[49]["id"] != float64(docs[10].ID) {
		t.Fatal("recent window wrong")
	}
	if len(list("?recent=true&q=menu-00")) != 0 {
		t.Fatal("search escaped the recent history window")
	}
	if got := list("?saved=true"); got[0]["id"] != float64(docs[0].ID) {
		t.Fatal("save chronology wrong")
	}
	if got := list("?favorite=true"); got[0]["id"] != float64(docs[59].ID) {
		t.Fatal("favorite chronology wrong")
	}
	path := fmt.Sprintf("/api/v1/documents/recipes/%d", docs[0].ID)
	w := request("GET", path, nil)
	var detail map[string]any
	json.Unmarshal(w.Body.Bytes(), &detail)
	if w.Code != 200 || detail["id"] != float64(docs[0].ID) || detail["saved_at"] == nil {
		t.Fatal("old retained document could not be opened")
	}
	// Client timestamps cannot move an old document to the front during edits.
	detail["created_at"] = "2099-01-01T00:00:00Z"
	detail["saved_at"] = "2099-01-01T00:00:00Z"
	detail["title"] = "edited"
	w = request("PUT", path, detail)
	if w.Code != 200 {
		t.Fatalf("edit %d %s", w.Code, w.Body)
	}
	var edited model.Document
	db.First(&edited, docs[0].ID)
	if !edited.CreatedAt.Equal(docs[0].CreatedAt) || !edited.SavedAt.Equal(*docs[0].SavedAt) || !edited.FavoritedAt.Equal(*docs[0].FavoritedAt) {
		t.Fatal("content edit reset chronological metadata")
	}
	other := model.Document{UserID: user.ID + 1, Kind: "recipes", Data: docs[0].Data}
	db.Create(&other)
	if w := request("GET", fmt.Sprintf("/api/v1/documents/recipes/%d", other.ID), nil); w.Code != 404 {
		t.Fatal("single document endpoint crossed ownership")
	}
}
