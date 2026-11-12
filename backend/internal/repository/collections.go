package repository

import (
	"ai-kitchen/internal/model"
	"encoding/json"
	"gorm.io/gorm"
	"time"
)

// Preserve the previous flattened collection as independently owned dish snapshots.
func migrateCollections(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var n int64
		if err := tx.Model(&model.Migration{}).Where("version = ?", 2).Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return nil
		}
		var docs []model.Document
		if err := tx.Where("kind = ?", "recipes").Find(&docs).Error; err != nil {
			return err
		}
		for _, doc := range docs {
			var menu model.Recipe
			if err := json.Unmarshal([]byte(doc.Data), &menu); err != nil {
				return err
			}
			for _, dish := range menu.Dishes {
				q := menu.Request
				q.Target = "dish"
				q.DishCount = 1
				b, err := json.Marshal(model.DishRecord{Dish: dish, Servings: menu.Servings, Saved: menu.Saved, Favorite: menu.Favorite, Warnings: menu.Warnings, Sources: menu.Sources, Request: q})
				if err != nil {
					return err
				}
				if err := tx.Create(&model.Document{UserID: doc.UserID, Kind: "dishes", Data: string(b)}).Error; err != nil {
					return err
				}
			}
		}
		return tx.Create(&model.Migration{Version: 2, AppliedAt: time.Now()}).Error
	})
}
