package handler

import (
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

func (s *Server) adminGlobalPrompt(c *gin.Context) {
	if !s.isAdmin(c) {
		return
	}
	if c.Request.Method == "GET" {
		prompt, err := service.GlobalPrompt(s.DB)
		if err != nil {
			bad(c, 500, "读取系统提示词失败")
			return
		}
		c.JSON(200, gin.H{"global_prompt": prompt})
		return
	}
	var body struct {
		Prompt *string `json:"global_prompt"`
	}
	if c.ShouldBindJSON(&body) != nil || body.Prompt == nil {
		bad(c, 400, "请提供全局提示词，清空时传入空字符串")
		return
	}
	if len([]rune(*body.Prompt)) > service.MaxGlobalPromptLength {
		bad(c, 400, "全局提示词最多 10000 字")
		return
	}
	if err := s.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model.Setting{Key: service.GlobalPromptKey, Value: *body.Prompt}).Error; err != nil {
		bad(c, 500, "保存系统提示词失败")
		return
	}
	c.JSON(200, gin.H{"global_prompt": *body.Prompt})
}
