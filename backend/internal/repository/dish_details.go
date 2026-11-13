package repository

import (
	"ai-kitchen/internal/calculator"
	"ai-kitchen/internal/model"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Upgrade stored snapshots once, so existing menus and their independent dishes
// receive the same per-dish breakdown as new generations. Food prices, nutrition,
// user flags and collection IDs remain the original snapshots.
func migrateDishDetails(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var migration model.Migration
		if err := tx.First(&migration, 4).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		equipment := map[uint][]model.Equipment{}
		prices := map[uint]float64{}
		var docs []model.Document
		if err := tx.Where("kind IN ?", []string{"equipment", "preferences"}).Find(&docs).Error; err != nil {
			return err
		}
		for _, doc := range docs {
			if doc.Kind == "equipment" {
				var e model.Equipment
				if err := json.Unmarshal([]byte(doc.Data), &e); err != nil {
					return err
				}
				e.ID = doc.ID
				equipment[doc.UserID] = append(equipment[doc.UserID], e)
			} else {
				var p model.Preferences
				if err := json.Unmarshal([]byte(doc.Data), &p); err != nil {
					return err
				}
				prices[doc.UserID] = p.ElectricityPrice
			}
		}
		priceFor := func(uid uint) float64 {
			if price, ok := prices[uid]; ok {
				return price
			}
			return .9
		}
		menuDishes := map[string]model.Dish{}
		if err := tx.Where("kind = ?", "recipes").Order("id asc").Find(&docs).Error; err != nil {
			return err
		}
		for _, doc := range docs {
			var menu model.Recipe
			if err := json.Unmarshal([]byte(doc.Data), &menu); err != nil {
				return err
			}
			price := priceFor(doc.UserID)
			if menu.KWh > 0 {
				price = menu.EnergyCost / menu.KWh
			}
			calculator.CalculateEnergy(&menu, equipment[doc.UserID], price)
			for _, dish := range menu.Dishes {
				if dish.CollectionID != 0 {
					menuDishes[fmt.Sprintf("%d/%d", doc.UserID, dish.CollectionID)] = dish
				}
			}
			raw, err := json.Marshal(menu)
			if err != nil {
				return err
			}
			if err := tx.Model(&doc).Update("data", string(raw)).Error; err != nil {
				return err
			}
		}
		// The identity schema gains computed fields; rebuild the canonical keys
		// together, preserving legacy duplicate IDs and references.
		if err := tx.Model(&model.Document{}).Where("kind = ?", "dishes").Update("collection_key", nil).Error; err != nil {
			return err
		}
		if err := tx.Where("kind = ?", "dishes").Order("id asc").Find(&docs).Error; err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, doc := range docs {
			var record model.DishRecord
			if err := json.Unmarshal([]byte(doc.Data), &record); err != nil {
				return err
			}
			if source, ok := menuDishes[fmt.Sprintf("%d/%d", doc.UserID, doc.ID)]; ok {
				if record.Usage == nil {
					record.Usage = source.Usage
					record.KWh, record.EnergyCost = source.KWh, source.EnergyCost
				}
				if record.Commentary == "" {
					record.Commentary = source.Commentary
				}
			}
			r := model.Recipe{Dishes: []model.Dish{record.Dish}}
			price := priceFor(doc.UserID)
			if record.KWh > 0 {
				price = record.EnergyCost / record.KWh
			}
			calculator.CalculateEnergy(&r, equipment[doc.UserID], price)
			record.Dish = r.Dishes[0]
			key, err := dishSnapshotKey(record)
			if err != nil {
				return err
			}
			ownerKey := fmt.Sprintf("%d/%s", doc.UserID, key)
			doc.CollectionKey = nil
			if !seen[ownerKey] {
				doc.CollectionKey = &key
				seen[ownerKey] = true
			}
			raw, err := json.Marshal(record)
			if err != nil {
				return err
			}
			doc.Data = string(raw)
			if err := tx.Save(&doc).Error; err != nil {
				return err
			}
		}
		return tx.Create(&model.Migration{Version: 4, AppliedAt: time.Now()}).Error
	})
}
