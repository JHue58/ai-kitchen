package repository

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
)

func TestHistoricalDishDetailsMigrationPreservesSnapshotsAndIdentity(t *testing.T) {
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "test.db")
	db, err := Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	owner := uint(7)
	create := func(kind string, value any) model.Document {
		raw, _ := json.Marshal(value)
		doc := model.Document{UserID: owner, Kind: kind, Data: string(raw)}
		if err := db.Create(&doc).Error; err != nil {
			t.Fatal(err)
		}
		return doc
	}
	watts := 2000.0
	device := create("equipment", model.Equipment{Name: "电炉", Electric: true, Watts: &watts})
	menu := model.Recipe{Title: "历史晚餐", Servings: 2, Cost: 36, Commentary: "整桌点评", KWh: 1, EnergyCost: .9, Dishes: []model.Dish{
		{Name: "番茄炒蛋", Description: "酸甜鲜香", Cost: 12, Ingredients: []model.Ingredient{{Name: "鸡蛋", Quantity: 2, Unit: "个"}}, Steps: []model.Step{{Step: 1, EquipmentID: device.ID, Duration: 10}}},
		{Name: "青菜", Description: "清淡爽口", Cost: 24, Ingredients: []model.Ingredient{{Name: "青菜", Quantity: 100, Unit: "g"}}, Steps: []model.Step{{Step: 1, EquipmentID: device.ID, Duration: 20, Start: 10}}},
	}, Usage: []model.Usage{{EquipmentID: device.ID, HeatingMinutes: 30}}}
	for i := range menu.Dishes {
		record := model.DishRecord{Dish: menu.Dishes[i], Servings: 2, Saved: true, Favorite: true}
		doc, _, err := SaveDishSnapshot(db, owner, record)
		if err != nil {
			t.Fatal(err)
		}
		menu.Dishes[i].CollectionID = doc.ID
	}
	doc := create("recipes", menu)
	db.Delete(&model.Migration{}, "version = ?", 4)
	for i := 0; i < 2; i++ {
		if err := migrateDishDetails(db); err != nil {
			t.Fatal(err)
		}
	}
	db.First(&doc, doc.ID)
	json.Unmarshal([]byte(doc.Data), &menu)
	if menu.Cost != 36 || menu.Commentary != "整桌点评" || math.Abs(menu.EnergyCost-.9) > 1e-9 {
		t.Fatalf("menu snapshot values changed: %+v", menu)
	}
	for i, dish := range menu.Dishes {
		var snapshot model.Document
		db.First(&snapshot, dish.CollectionID)
		var record model.DishRecord
		json.Unmarshal([]byte(snapshot.Data), &record)
		if !record.Saved || !record.Favorite || record.Commentary != dish.Description || len(record.Usage) != 1 || math.Abs(record.EnergyCost-dish.EnergyCost) > 1e-9 || record.Ingredients[0].Category != "main" || record.Cost != float64(12*(i+1)) {
			t.Fatalf("dish metadata or snapshot lost: %+v", record)
		}
		// Enriching an already collected recipe cannot create a second entry.
		record.Commentary = "新增点评"
		record.EnergyCost = 9
		record.Ingredients[0].Category = "supporting"
		saved, created, err := SaveDishSnapshot(db, owner, record)
		if err != nil || created || saved.ID != snapshot.ID {
			t.Fatalf("metadata upgrade changed collection identity: %d %v %v", saved.ID, created, err)
		}
	}
}
