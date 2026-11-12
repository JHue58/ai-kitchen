package repository

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"os"
	"path/filepath"
	"time"
)

func Open(c config.Config) (*gorm.DB, error) {
	var d gorm.Dialector
	switch c.Database.Driver {
	case "sqlite":
		if e := os.MkdirAll(filepath.Dir(c.Database.DSN), 0700); e != nil {
			return nil, e
		}
		d = sqlite.Open(c.Database.DSN + "?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on")
	case "postgres":
		d = postgres.Open(c.Database.DSN)
	default:
		return nil, fmt.Errorf("不支持的数据库")
	}
	db, e := gorm.Open(d, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if e != nil {
		return nil, e
	}
	sql, e := db.DB()
	if e != nil {
		return nil, e
	}
	if c.Database.Driver == "sqlite" {
		sql.SetMaxOpenConns(1)
	}
	e = db.Transaction(func(tx *gorm.DB) error {
		if e := tx.AutoMigrate(&model.Migration{}); e != nil {
			return e
		}
		var count int64
		tx.Model(&model.Migration{}).Where("version = ?", 1).Count(&count)
		if count == 0 {
			if e := tx.AutoMigrate(&model.User{}, &model.Session{}, &model.Document{}, &model.Job{}, &model.Cache{}, &model.Setting{}); e != nil {
				return e
			}
			return tx.Create(&model.Migration{Version: 1, AppliedAt: time.Now()}).Error
		}
		return nil
	})
	if e == nil {
		e = db.AutoMigrate(&model.Job{})
	}
	if e == nil {
		e = migrateCollections(db)
	}
	return db, e
}
