package repository

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"gorm.io/gorm"
)

func TestDishSnapshotConcurrentSavesAndOwnership(t *testing.T) {
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	db, err := Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	record := model.DishRecord{Servings: 2, Dish: model.Dish{Name: "番茄炒蛋", Ingredients: []model.Ingredient{{Name: "鸡蛋", Quantity: 2, Unit: "个"}}, Steps: []model.Step{{Title: "翻炒", Description: "炒熟", Start: 5}}}}
	initial, created, err := SaveDishSnapshot(db, 7, record)
	if err != nil || !created {
		t.Fatalf("initial save failed: %v", err)
	}
	// A menu timeline shift and later image cannot create another recipe.
	record.Steps[0].Start = 20
	record.Image = &model.DishImage{URL: "https://example.com/egg.jpg"}
	record.Saved = true
	record.ChatSuggestions = []model.ChatSuggestion{{Label: "嫩一点", Message: "怎样让鸡蛋更嫩？"}}
	const clicks = 12
	ids := make(chan uint, clicks)
	errs := make(chan error, clicks)
	var wg sync.WaitGroup
	for i := 0; i < clicks; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			doc, _, err := SaveDishSnapshot(db, 7, record)
			ids <- doc.ID
			errs <- err
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for id := range ids {
		if id != initial.ID {
			t.Fatalf("repeated click created duplicate: %d != %d", id, initial.ID)
		}
	}
	db.First(&initial, initial.ID)
	var saved model.DishRecord
	json.Unmarshal([]byte(initial.Data), &saved)
	if !saved.Saved {
		t.Fatal("explicit save did not promote saved state")
	}
	legacy := model.Document{UserID: 7, Kind: "dishes", Data: initial.Data}
	db.Create(&legacy)
	if err := UpdateDishSnapshot(db, &legacy); err != nil || legacy.CollectionKey != nil {
		t.Fatalf("legacy duplicate cannot be edited safely: %v", err)
	}
	other, _, err := SaveDishSnapshot(db, 8, record)
	if err != nil || other.ID == initial.ID || other.UserID != 8 {
		t.Fatal("snapshot identity crossed ownership")
	}
	record.Ingredients[0].Quantity = 3
	variant, created, err := SaveDishSnapshot(db, 7, record)
	if err != nil || !created || variant.ID == initial.ID {
		t.Fatal("different recipe with same name was collapsed")
	}
	// Editing a snapshot must release its old identity.
	record.Name = "三蛋番茄炒蛋"
	raw, _ := json.Marshal(record)
	variant.Data = string(raw)
	if err := UpdateDishSnapshot(db, &variant); err != nil {
		t.Fatal(err)
	}
	record.Name = "番茄炒蛋"
	restored, created, err := SaveDishSnapshot(db, 7, record)
	if err != nil || !created || restored.ID == variant.ID {
		t.Fatal("edited snapshot retained stale identity")
	}
}

func TestMenuCollectionBackfillAndTransaction(t *testing.T) {
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	db, err := Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	menu := model.Recipe{Title: "旧菜单", Servings: 2, Dishes: []model.Dish{{Name: "鸡蛋"}, {Name: "西兰花"}}}
	raw, _ := json.Marshal(menu)
	doc := model.Document{UserID: 9, Kind: "recipes", Data: string(raw)}
	db.Create(&doc)
	db.Delete(&model.Migration{}, "version = ?", 3)
	for i := 0; i < 2; i++ {
		if err := migrateDishIdentities(db); err != nil {
			t.Fatal(err)
		}
	}
	db.First(&doc, doc.ID)
	json.Unmarshal([]byte(doc.Data), &menu)
	for _, dish := range menu.Dishes {
		var snapshot model.Document
		if dish.CollectionID == 0 || db.First(&snapshot, dish.CollectionID).Error != nil || snapshot.UserID != 9 {
			t.Fatalf("old menu dish missing independent snapshot: %+v", dish)
		}
	}
	var count int64
	db.Model(&model.Document{}).Where("kind = ?", "dishes").Count(&count)
	if count != 2 {
		t.Fatalf("backfill duplicated dishes: %d", count)
	}
	// A failed menu transaction must not leave orphan auto-collected entries.
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := CollectMenuDishes(tx, 10, &menu); err != nil {
			return err
		}
		return errors.New("menu save failed")
	})
	if err == nil {
		t.Fatal("expected failed menu transaction")
	}
	db.Model(&model.Document{}).Where("user_id = ? AND kind = ?", 10, "dishes").Count(&count)
	if count != 0 {
		t.Fatal("failed menu save left auto-collected dishes")
	}
}
