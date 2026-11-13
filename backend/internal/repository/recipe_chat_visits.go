package repository

import (
	"ai-kitchen/internal/model"
	"time"

	"gorm.io/gorm"
)

// Old document-long transcripts are intentionally removed on this upgrade.
// A new page visit can never inherit a previous visit's conversation.
func migrateRecipeChatVisits(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Migrator().HasIndex(&model.RecipeChat{}, "recipe_chat_owner") {
			if err := tx.Migrator().DropIndex(&model.RecipeChat{}, "recipe_chat_owner"); err != nil {
				return err
			}
		}
		if err := tx.AutoMigrate(&model.RecipeChat{}); err != nil {
			return err
		}
		if err := tx.Where("visit_id = '' OR visit_id IS NULL OR updated_at < ?", time.Now().Add(-24*time.Hour)).Delete(&model.RecipeChat{}).Error; err != nil {
			return err
		}
		return nil
	})
}
