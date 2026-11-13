package repository

import (
	"ai-kitchen/internal/model"
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

const RecentCollectionLimit = 50

func collectionFlags(raw string) (saved, favorite bool) {
	var flags struct {
		Saved    bool `json:"saved"`
		Favorite bool `json:"favorite"`
	}
	_ = json.Unmarshal([]byte(raw), &flags)
	return flags.Saved, flags.Favorite
}

// Action dates belong to the server. Content edits and background image writes
// never move an existing save/favorite to the front of its collection.
func SetCollectionActionTimes(doc *model.Document, previousData string, now time.Time) {
	if doc.Kind != "recipes" && doc.Kind != "dishes" {
		return
	}
	saved, favorite := collectionFlags(doc.Data)
	wasSaved, wasFavorite := collectionFlags(previousData)
	if !saved {
		doc.SavedAt = nil
	} else if !wasSaved || doc.SavedAt == nil {
		value := now
		doc.SavedAt = &value
	}
	if !favorite {
		doc.FavoritedAt = nil
	} else if !wasFavorite || doc.FavoritedAt == nil {
		value := now
		doc.FavoritedAt = &value
	}
}

func DocumentData(doc model.Document) (map[string]any, error) {
	var data map[string]any
	if err := json.Unmarshal([]byte(doc.Data), &data); err != nil {
		return nil, err
	}
	data["id"] = doc.ID
	data["created_at"], data["updated_at"] = doc.CreatedAt, doc.UpdatedAt
	data["generated_at"] = doc.CreatedAt
	if doc.GeneratedAt != nil {
		data["generated_at"] = doc.GeneratedAt
	}
	data["saved_at"], data["favorited_at"] = doc.SavedAt, doc.FavoritedAt
	return data, nil
}

// Retain the newest ordinary history entries. Explicit saves and favorites are
// independent collections and do not expire when recent history rolls over.
func PruneCollectionHistory(db *gorm.DB, userID uint, kind string) error {
	if kind != "recipes" && kind != "dishes" {
		return nil
	}
	var docs []model.Document
	if err := db.Where("user_id = ? AND kind = ?", userID, kind).Order("COALESCE(generated_at, created_at) desc, id desc").Find(&docs).Error; err != nil {
		return err
	}
	ordinary := 0
	remove := []uint{}
	for _, doc := range docs {
		saved, favorite := collectionFlags(doc.Data)
		if saved || favorite {
			continue
		}
		if ordinary < RecentCollectionLimit {
			ordinary++
			continue
		}
		remove = append(remove, doc.ID)
	}
	if len(remove) == 0 {
		return nil
	}
	if err := db.Where("user_id = ? AND kind = ? AND document_id IN ?", userID, kind, remove).Delete(&model.RecipeChat{}).Error; err != nil {
		return err
	}
	return db.Where("user_id = ? AND kind = ? AND id IN ?", userID, kind, remove).Delete(&model.Document{}).Error
}

// Backfill legacy action dates once using the last known edit time; exact old
// save/favorite dates were not recorded by previous versions.
func migrateCollectionHistory(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var migration model.Migration
		if err := tx.First(&migration, 6).Error; err == nil {
			return nil
		} else if err != gorm.ErrRecordNotFound {
			return err
		}
		var docs []model.Document
		if err := tx.Where("kind IN ?", []string{"recipes", "dishes"}).Find(&docs).Error; err != nil {
			return err
		}
		owners := map[uint]bool{}
		for _, doc := range docs {
			owners[doc.UserID] = true
			now := doc.UpdatedAt
			if now.IsZero() {
				now = doc.CreatedAt
			}
			SetCollectionActionTimes(&doc, "", now)
			if err := tx.Model(&doc).UpdateColumns(map[string]any{"saved_at": doc.SavedAt, "favorited_at": doc.FavoritedAt}).Error; err != nil {
				return err
			}
		}
		for owner := range owners {
			for _, kind := range []string{"recipes", "dishes"} {
				if err := PruneCollectionHistory(tx, owner, kind); err != nil {
					return err
				}
			}
		}
		return tx.Create(&model.Migration{Version: 6, AppliedAt: time.Now()}).Error
	})
}
