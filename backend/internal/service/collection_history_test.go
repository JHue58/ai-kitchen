package service

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestGenerationSaveEnforcesRecentHistoryWithoutLosingRetainedRecipes(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "history.db")
	db, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	protected, err := Save(db, 7, "recipes", model.Recipe{Title: "saved", Servings: 2, Saved: true})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 54; i++ {
		if _, err := Save(db, 7, "recipes", model.Recipe{Title: fmt.Sprintf("menu-%d", i), Servings: 2}); err != nil {
			t.Fatal(err)
		}
	}
	rows := Read[map[string]any](db, 7, "recipes")
	if len(rows) != 51 || rows[0]["title"] != "menu-53" || rows[49]["title"] != "menu-4" || rows[50]["id"] != float64(protected.ID) {
		t.Fatalf("unexpected retained history: len=%d first=%v", len(rows), rows[0])
	}
	if rows[0]["created_at"] == nil || rows[50]["saved_at"] == nil {
		t.Fatal("history omitted ordering metadata")
	}
	for i := 0; i < 54; i++ {
		record := model.DishRecord{Servings: 2, Dish: model.Dish{Name: fmt.Sprintf("dish-%d", i)}}
		if _, err := Save(db, 7, "dishes", record); err != nil {
			t.Fatal(err)
		}
	}
	if got := Read[map[string]any](db, 7, "dishes"); len(got) != 50 || got[0]["name"] != "dish-53" {
		t.Fatal("independent dish history did not roll over")
	}
	if got := Read[map[string]any](db, 7, "recipes"); len(got) != 51 {
		t.Fatal("dish generation removed menu history")
	}
}

func TestReusedGenerationBecomesRecentWithoutResettingCreationOrActionDates(t *testing.T) {
	var cfg config.Config
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "reuse-history.db")
	db, err := repository.Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	record := model.DishRecord{Servings: 2, Dish: model.Dish{Name: "reused dish"}}
	old, _, err := repository.SaveDishSnapshot(db, 7, record)
	if err != nil {
		t.Fatal(err)
	}
	created := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	db.Model(&old).UpdateColumn("created_at", created)
	others := []model.Document{}
	for i := 0; i < 50; i++ {
		doc, _, err := repository.SaveDishSnapshot(db, 7, model.DishRecord{Servings: 2, Dish: model.Dish{Name: fmt.Sprintf("other-%d", i)}})
		if err != nil {
			t.Fatal(err)
		}
		db.Model(&doc).UpdateColumn("created_at", created.Add(time.Duration(i+1)*time.Hour))
		others = append(others, doc)
	}
	generated, err := Save(db, 7, "dishes", record)
	if err != nil {
		t.Fatal(err)
	}
	if generated.ID != old.ID || generated.GeneratedAt == nil || !generated.CreatedAt.Equal(created) {
		t.Fatal("reuse lost its identity, generation date, or original creation")
	}
	rows := Read[map[string]any](db, 7, "dishes")
	if len(rows) != 50 || rows[0]["id"] != float64(old.ID) || rows[1]["id"] != float64(others[49].ID) {
		t.Fatalf("reuse did not enter the newest history position len=%d first=%v second=%v generated=%v", len(rows), rows[0], rows[1], generated.GeneratedAt)
	}
	var count int64
	db.Model(&model.Document{}).Where("id=?", others[0].ID).Count(&count)
	if count != 0 {
		t.Fatal("rolling history did not expire the chronologically oldest other dish")
	}
	record.Saved = true
	promoted, _, err := repository.SaveDishSnapshot(db, 7, record)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.GeneratedAt == nil || !promoted.GeneratedAt.Equal(*generated.GeneratedAt) || !promoted.CreatedAt.Equal(created) || promoted.SavedAt == nil {
		t.Fatal("explicit save changed generation chronology")
	}
	menu := model.Recipe{Title: "reuse menu", Servings: 2, Dishes: []model.Dish{{Name: record.Name, CollectionID: old.ID}}}
	parent, err := Save(db, 7, "recipes", menu)
	if err != nil {
		t.Fatal(err)
	}
	var refreshed model.Document
	db.First(&refreshed, old.ID)
	if refreshed.GeneratedAt == nil || !refreshed.GeneratedAt.Equal(*parent.GeneratedAt) || !refreshed.SavedAt.Equal(*promoted.SavedAt) || !refreshed.CreatedAt.Equal(created) {
		t.Fatal("menu generation did not refresh reused dish generation only")
	}
}
