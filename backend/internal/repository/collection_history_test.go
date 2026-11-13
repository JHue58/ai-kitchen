package repository

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/gorm"
)

func historyDB(t *testing.T) *gorm.DB {
	t.Helper()
	var c config.Config
	c.Database.Driver, c.Database.DSN = "sqlite", filepath.Join(t.TempDir(), "history.db")
	db, err := Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	t.Cleanup(func() { sql.Close() })
	return db
}

func TestCollectionHistoryPrunesOnlyOldUnprotectedOwnerKind(t *testing.T) {
	db := historyDB(t)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	docs := []model.Document{}
	for i := 0; i < 55; i++ {
		doc := model.Document{UserID: 7, Kind: "recipes", CreatedAt: start.Add(time.Duration(i) * time.Hour), Data: fmt.Sprintf(`{"title":"menu-%d"}`, i)}
		if err := db.Create(&doc).Error; err != nil {
			t.Fatal(err)
		}
		docs = append(docs, doc)
	}
	// Old explicitly retained entries never consume the rolling history limit.
	for i, flag := range []string{"saved", "favorite"} {
		db.Model(&docs[i]).Update("data", fmt.Sprintf(`{"title":"protected","%s":true}`, flag))
	}
	other := model.Document{UserID: 8, Kind: "recipes", Data: `{"title":"another owner"}`}
	db.Create(&other)
	dish := model.Document{UserID: 7, Kind: "dishes", Data: `{"name":"another kind"}`}
	db.Create(&dish)
	chat := model.RecipeChat{UserID: 7, Kind: "recipes", DocumentID: docs[2].ID}
	db.Create(&chat)
	if err := db.Transaction(func(tx *gorm.DB) error { return PruneCollectionHistory(tx, 7, "recipes") }); err != nil {
		t.Fatal(err)
	}
	var kept []model.Document
	db.Where("user_id=? AND kind=?", 7, "recipes").Order("created_at desc").Find(&kept)
	if len(kept) != 52 {
		t.Fatalf("want 50 recent plus 2 protected, got %d", len(kept))
	}
	for _, doc := range []model.Document{docs[0], docs[1], other, dish, docs[54]} {
		var found model.Document
		if err := db.First(&found, doc.ID).Error; err != nil {
			t.Fatalf("retained document %d missing: %v", doc.ID, err)
		}
	}
	for _, doc := range docs[2:5] {
		var n int64
		db.Model(&model.Document{}).Where("id=?", doc.ID).Count(&n)
		if n != 0 {
			t.Fatalf("expired document %d kept", doc.ID)
		}
	}
	var n int64
	db.Model(&model.RecipeChat{}).Where("id=?", chat.ID).Count(&n)
	if n != 0 {
		t.Fatal("expired conversation was orphaned")
	}
	// Removing explicit retention from an expired old record must not displace
	// a genuinely newer generation from the fifty-entry window.
	db.Model(&docs[0]).Update("data", `{"title":"old unsaved","saved":false}`)
	if err := PruneCollectionHistory(db, 7, "recipes"); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Document{}).Where("id=?", docs[0].ID).Count(&n)
	if n != 0 {
		t.Fatal("expired unsaved record was pinned")
	}
	var newestWindowCount int64
	ids := []uint{}
	for _, doc := range docs[5:] {
		ids = append(ids, doc.ID)
	}
	db.Model(&model.Document{}).Where("id IN ?", ids).Count(&newestWindowCount)
	if newestWindowCount != 50 {
		t.Fatal("unsaving an old record evicted a newer generation")
	}
}

func TestCollectionActionTimesTrackTransitionsNotEdits(t *testing.T) {
	first := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	later := first.Add(time.Hour)
	doc := model.Document{Kind: "recipes", Data: `{"saved":true,"favorite":true}`}
	SetCollectionActionTimes(&doc, "{}", first)
	if doc.SavedAt == nil || !doc.SavedAt.Equal(first) || doc.FavoritedAt == nil || !doc.FavoritedAt.Equal(first) {
		t.Fatal("initial action dates missing")
	}
	SetCollectionActionTimes(&doc, `{"saved":true,"favorite":true}`, later)
	if !doc.SavedAt.Equal(first) || !doc.FavoritedAt.Equal(first) {
		t.Fatal("content edit changed action dates")
	}
	doc.Data = `{"saved":false,"favorite":true}`
	SetCollectionActionTimes(&doc, `{"saved":true,"favorite":true}`, later)
	if doc.SavedAt != nil || !doc.FavoritedAt.Equal(first) {
		t.Fatal("unsave did not clear only its own timestamp")
	}
	doc.Data = `{"saved":true,"favorite":true}`
	SetCollectionActionTimes(&doc, `{"saved":false,"favorite":true}`, later)
	if !doc.SavedAt.Equal(later) || !doc.FavoritedAt.Equal(first) {
		t.Fatal("resaving did not move just the saved collection")
	}
}

func TestHistoryMigrationBackfillsWithoutRewritingChronology(t *testing.T) {
	db := historyDB(t)
	db.Delete(&model.Migration{}, "version=?", 6)
	created := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	edited := created.Add(48 * time.Hour)
	doc := model.Document{UserID: 9, Kind: "recipes", CreatedAt: created, UpdatedAt: edited, Data: `{"title":"old","saved":true,"favorite":true}`}
	db.Create(&doc)
	for i := 0; i < 2; i++ {
		if err := migrateCollectionHistory(db); err != nil {
			t.Fatal(err)
		}
	}
	var found model.Document
	db.First(&found, doc.ID)
	if !found.CreatedAt.Equal(created) || !found.UpdatedAt.Equal(edited) || found.SavedAt == nil || !found.SavedAt.Equal(edited) || found.FavoritedAt == nil || !found.FavoritedAt.Equal(edited) {
		t.Fatalf("bad backfill: %+v", found)
	}
	data, err := DocumentData(found)
	if err != nil || data["created_at"] != found.CreatedAt {
		t.Fatal("authoritative document timestamps missing", err)
	}
}

func TestSnapshotPromotionKeepsGenerationAndOriginalSaveDates(t *testing.T) {
	db := historyDB(t)
	record := model.DishRecord{Servings: 2, Dish: model.Dish{Name: "番茄炒蛋", Ingredients: []model.Ingredient{{Name: "鸡蛋", Quantity: 2, Unit: "个"}}, Steps: []model.Step{{Description: "炒熟"}}}}
	first, _, err := SaveDishSnapshot(db, 7, record)
	if err != nil {
		t.Fatal(err)
	}
	record.Saved = true
	saved, _, err := SaveDishSnapshot(db, 7, record)
	if err != nil {
		t.Fatal(err)
	}
	if saved.SavedAt == nil || saved.ID != first.ID || !saved.CreatedAt.Equal(first.CreatedAt) {
		t.Fatal("promotion lost date or identity")
	}
	again, _, err := SaveDishSnapshot(db, 7, record)
	if err != nil {
		t.Fatal(err)
	}
	if !again.SavedAt.Equal(*saved.SavedAt) {
		t.Fatal("repeat save changed saved date")
	}
	data, _ := json.Marshal(map[string]any{"id": 999, "created_at": "spoof"})
	first.Data = string(data)
	flattened, _ := DocumentData(first)
	if flattened["id"] != first.ID || flattened["created_at"] != first.CreatedAt {
		t.Fatal("payload spoofed authoritative metadata")
	}
}
