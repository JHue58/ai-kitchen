package repository

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestLegacyDishMigrationIsIndependentAndIdempotent(t *testing.T) {
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	db, err := Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	// Simulate a version-one database containing an existing saved menu.
	db.Delete(&model.Migration{}, "version = ?", 2)
	b, _ := json.Marshal(model.Recipe{Title: "旧菜单", Servings: 2, Saved: true, Favorite: true, Dishes: []model.Dish{{Name: "旧菜品"}}})
	menu := model.Document{UserID: 7, Kind: "recipes", Data: string(b)}
	db.Create(&menu)
	for i := 0; i < 2; i++ {
		if err := migrateCollections(db); err != nil {
			t.Fatal(err)
		}
	}
	var dishes []model.Document
	db.Where("kind = ?", "dishes").Find(&dishes)
	if len(dishes) != 1 || dishes[0].UserID != 7 {
		t.Fatalf("migration duplicated or lost ownership: %+v", dishes)
	}
	var d model.DishRecord
	json.Unmarshal([]byte(dishes[0].Data), &d)
	if !d.Saved || !d.Favorite || d.Name != "旧菜品" || d.Servings != 2 {
		t.Fatalf("lost metadata: %+v", d)
	}
	db.Delete(&menu)
	if db.First(&model.Document{}, dishes[0].ID).Error != nil {
		t.Fatal("dish depends on menu")
	}
}
