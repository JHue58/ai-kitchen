package repository

import (
	"ai-kitchen/internal/model"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Snapshot identity follows the actual recipe and serving size. Images,
// collection links, calculated prices and menu timeline offsets can change
// independently without turning the same dish into another collection entry.
func dishSnapshotKey(record model.DishRecord) (string, error) {
	raw, err := json.Marshal(record.Dish)
	if err != nil {
		return "", err
	}
	var dish model.Dish
	if err := json.Unmarshal(raw, &dish); err != nil {
		return "", err
	}
	dish.CollectionID, dish.ReuseFrom, dish.Image = 0, nil, nil
	dish.ChatSuggestions = nil
	dish.Cost, dish.Nutrition = 0, model.Nutrition{}
	// Classification, commentary and energy estimates enrich an existing recipe;
	// they must not change its collection identity.
	dish.Commentary, dish.Usage, dish.KWh, dish.EnergyCost = "", nil, 0, 0
	for i := range dish.Ingredients {
		ingredient := &dish.Ingredients[i]
		ingredient.IsPantry = false
		ingredient.Category = ""
		ingredient.Cost, ingredient.CostSource, ingredient.NutritionSource = nil, "", ""
		ingredient.Totals = model.Nutrition{}
	}
	if len(dish.Steps) > 0 {
		start := dish.Steps[0].Start
		for i := range dish.Steps {
			dish.Steps[i].Start -= start
		}
	}
	raw, err = json.Marshal(struct {
		Dish     model.Dish
		Servings int
	}{dish, record.Servings})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// SaveDishSnapshot is owner-scoped and idempotent, including concurrent saves.
// A repeated save preserves user edits and only promotes saved/favorite flags.
func SaveDishSnapshot(db *gorm.DB, uid uint, record model.DishRecord) (model.Document, bool, error) {
	record.CollectionID = 0
	key, err := dishSnapshotKey(record)
	if err != nil {
		return model.Document{}, false, err
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return model.Document{}, false, err
	}
	doc := model.Document{UserID: uid, Kind: "dishes", CollectionKey: &key, Data: string(raw)}
	SetCollectionActionTimes(&doc, "", time.Now())
	result := db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "kind"}, {Name: "collection_key"}}, DoNothing: true}).Create(&doc)
	if result.Error != nil {
		return model.Document{}, false, result.Error
	}
	if result.RowsAffected > 0 {
		return doc, true, nil
	}
	for attempt := 0; attempt < 5; attempt++ {
		if err := db.Where("user_id = ? AND kind = ? AND collection_key = ?", uid, "dishes", key).First(&doc).Error; err != nil {
			return model.Document{}, false, err
		}
		var existing model.DishRecord
		if err := json.Unmarshal([]byte(doc.Data), &existing); err != nil {
			return model.Document{}, false, err
		}
		if (!record.Saved || existing.Saved) && (!record.Favorite || existing.Favorite) {
			return doc, false, nil
		}
		previousData := doc.Data
		existing.Saved = existing.Saved || record.Saved
		existing.Favorite = existing.Favorite || record.Favorite
		raw, err = json.Marshal(existing)
		if err != nil {
			return model.Document{}, false, err
		}
		doc.Data = string(raw)
		SetCollectionActionTimes(&doc, previousData, time.Now())
		updated := db.Model(&model.Document{}).Where("id = ? AND user_id = ? AND data = ?", doc.ID, uid, previousData).Updates(map[string]any{"data": doc.Data, "saved_at": doc.SavedAt, "favorited_at": doc.FavoritedAt})
		if updated.Error != nil {
			return model.Document{}, false, updated.Error
		}
		if updated.RowsAffected > 0 {
			doc.Data = string(raw)
			return doc, false, nil
		}
	}
	return model.Document{}, false, fmt.Errorf("菜品正在修改，请重试保存")
}

// Keep the identity current when a user edits an independent snapshot.
func UpdateDishSnapshot(db *gorm.DB, doc *model.Document) error {
	var record model.DishRecord
	if err := json.Unmarshal([]byte(doc.Data), &record); err != nil {
		return err
	}
	record.CollectionID = 0
	key, err := dishSnapshotKey(record)
	if err != nil {
		return err
	}
	// Historical duplicate IDs may still be referenced by jobs and links. Keep
	// them editable while all new saves resolve to the indexed canonical entry.
	var count int64
	if err := db.Model(&model.Document{}).Where("user_id = ? AND kind = ? AND collection_key = ? AND id <> ?", doc.UserID, "dishes", key, doc.ID).Count(&count).Error; err != nil {
		return err
	}
	doc.CollectionKey = nil
	if count == 0 {
		doc.CollectionKey = &key
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	doc.Data = string(raw)
	return db.Save(doc).Error
}

// CollectMenuDishes runs inside the same transaction as the menu save. Each
// independent snapshot survives removal of its source menu.
func CollectMenuDishes(db *gorm.DB, uid uint, menu *model.Recipe) error {
	for i := range menu.Dishes {
		request := menu.Request
		request.Target, request.DishCount = "dish", 1
		record := model.DishRecord{Dish: menu.Dishes[i], Servings: menu.Servings, Warnings: menu.Warnings, Sources: menu.Sources, Request: request, ImageStatus: menu.ImageStatus, TokenUsage: menu.TokenUsage}
		doc, _, err := SaveDishSnapshot(db, uid, record)
		if err != nil {
			return err
		}
		menu.Dishes[i].CollectionID = doc.ID
	}
	return nil
}

// Index existing independent dishes, then fill in missing dishes from menus.
// Existing document IDs remain valid for jobs and bookmarked dish links.
func migrateDishIdentities(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var migration model.Migration
		err := tx.First(&migration, 3).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var docs []model.Document
		if err := tx.Where("kind = ?", "dishes").Order("id asc").Find(&docs).Error; err != nil {
			return err
		}
		for _, doc := range docs {
			var record model.DishRecord
			if err := json.Unmarshal([]byte(doc.Data), &record); err != nil {
				return err
			}
			key, err := dishSnapshotKey(record)
			if err != nil {
				return err
			}
			var count int64
			if err := tx.Model(&model.Document{}).Where("user_id = ? AND kind = ? AND collection_key = ?", doc.UserID, "dishes", key).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				if err := tx.Model(&doc).Update("collection_key", key).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Where("kind = ?", "recipes").Find(&docs).Error; err != nil {
			return err
		}
		for _, doc := range docs {
			var menu model.Recipe
			if err := json.Unmarshal([]byte(doc.Data), &menu); err != nil {
				return err
			}
			if err := CollectMenuDishes(tx, doc.UserID, &menu); err != nil {
				return err
			}
			raw, err := json.Marshal(menu)
			if err != nil {
				return err
			}
			if err := tx.Model(&doc).Update("data", string(raw)).Error; err != nil {
				return err
			}
		}
		return tx.Create(&model.Migration{Version: 3, AppliedAt: time.Now()}).Error
	})
}
