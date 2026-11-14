package handler

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestAdminUserGenerationsAuthorizationScopeAndPagination(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "admin-history.db")
	db, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	t.Cleanup(func() { sql.Close() })
	admin := model.User{Username: "admin", Admin: true, Password: "never-expose-this"}
	alice := model.User{Username: "alice", Password: "also-private"}
	bob := model.User{Username: "bob"}
	for _, user := range []*model.User{&admin, &alice, &bob} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	for token, userID := range map[string]uint{"admin-token": admin.ID, "alice-token": alice.ID} {
		if err := db.Create(&model.Session{ID: digest(token), UserID: userID, ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	base := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	create := func(userID uint, kind, raw string, created time.Time, generated *time.Time) model.Document {
		doc := model.Document{UserID: userID, Kind: kind, Data: raw, CreatedAt: created, GeneratedAt: generated, UpdatedAt: base.Add(24 * time.Hour)}
		if err := db.Create(&doc).Error; err != nil {
			t.Fatal(err)
		}
		return doc
	}
	old := create(alice.ID, "recipes", `{"title":"旧菜谱","dishes":[{"name":"番茄炒蛋"}]}`, base, nil)
	regenerated := base.Add(3 * time.Hour)
	latest := create(alice.ID, "dishes", `{"name":"清炒西兰花","kind":"forged","steps":[{"description":"炒熟"}]}`, base.Add(time.Hour), &regenerated)
	tie := create(alice.ID, "recipes", `{"title":"最新菜单","dishes":[{"name":"蒸鱼"}]}`, regenerated, nil)
	create(alice.ID, "preferences", `{"notes":"private preferences"}`, base.Add(10*time.Hour), nil)
	create(bob.ID, "recipes", `{"title":"Bob's private menu"}`, base.Add(10*time.Hour), nil)
	router := (&Server{DB: db, C: cfg}).Router()
	request := func(path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			r.AddCookie(&http.Cookie{Name: "kitchen_session", Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	path := fmt.Sprintf("/api/v1/admin/users/%d/generations", alice.ID)
	for token, expected := range map[string]int{"": 401, "alice-token": 403} {
		if w := request(path, token); w.Code != expected {
			t.Fatalf("authorization %q: %d %s", token, w.Code, w.Body)
		}
	}
	type page struct {
		User    map[string]any   `json:"user"`
		Items   []map[string]any `json:"items"`
		Total   int              `json:"total"`
		Limit   int              `json:"limit"`
		Offset  int              `json:"offset"`
		HasMore bool             `json:"has_more"`
	}
	read := func(query string) page {
		t.Helper()
		w := request(path+query, "admin-token")
		if w.Code != 200 {
			t.Fatalf("history %d: %s", w.Code, w.Body)
		}
		var out page
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	first := read("?limit=2")
	if first.Total != 3 || first.Limit != 2 || first.Offset != 0 || !first.HasMore || len(first.Items) != 2 {
		t.Fatalf("incorrect first page: %+v", first)
	}
	if first.User["username"] != "alice" || first.User["password"] != nil || first.User["Password"] != nil {
		t.Fatalf("incorrect user or exposed credentials: %+v", first.User)
	}
	if first.Items[0]["id"] != float64(tie.ID) || first.Items[1]["id"] != float64(latest.ID) || first.Items[1]["kind"] != "dishes" {
		t.Fatalf("incorrect generated ordering or document kind: %+v", first.Items)
	}
	if first.Items[1]["generated_at"] != regenerated.Format(time.RFC3339) || first.Items[1]["steps"] == nil {
		t.Fatalf("missing generation time or detail: %+v", first.Items[1])
	}
	second := read("?limit=2&offset=2")
	if len(second.Items) != 1 || second.Items[0]["id"] != float64(old.ID) || second.HasMore || second.Offset != 2 {
		t.Fatalf("incorrect second page: %+v", second)
	}
	menus := read("?kind=recipes")
	if menus.Total != 2 || len(menus.Items) != 2 || menus.Limit != 12 || menus.HasMore {
		t.Fatalf("incorrect menu filter: %+v", menus)
	}
	dishes := read("?kind=dishes")
	if dishes.Total != 1 || len(dishes.Items) != 1 || dishes.Items[0]["id"] != float64(latest.ID) {
		t.Fatalf("incorrect dish filter: %+v", dishes)
	}
	empty := read("?offset=20")
	if empty.Items == nil || len(empty.Items) != 0 || empty.HasMore {
		t.Fatalf("empty page should be an array: %+v", empty)
	}
	// The new administrator route must not weaken the regular ownership boundary.
	w := request(fmt.Sprintf("/api/v1/documents/recipes/%d", tie.ID), "admin-token")
	if w.Code != 404 {
		t.Fatalf("ordinary document ownership changed: %d %s", w.Code, w.Body)
	}
	for _, query := range []string{"?limit=0", "?limit=51", "?limit=bad", "?offset=-1", "?offset=bad", "?kind=preferences", "?kind="} {
		if w := request(path+query, "admin-token"); w.Code != 400 {
			t.Fatalf("invalid query %q: %d %s", query, w.Code, w.Body)
		}
	}
	for id, expected := range map[string]int{"0": 400, "bad": 400, "999999": 404} {
		if w := request("/api/v1/admin/users/"+id+"/generations", "admin-token"); w.Code != expected {
			t.Fatalf("user id %q: %d %s", id, w.Code, w.Body)
		}
	}
	if w := request(fmt.Sprintf("/api/v1/admin/users/%d/generations", bob.ID), "admin-token"); w.Code != 200 {
		t.Fatalf("other user's history: %d %s", w.Code, w.Body)
	}
}
