package handler

import (
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// The administrator reads the owner's retained generation history through this
// dedicated endpoint; ordinary document routes keep their ownership checks.
func (s *Server) adminUserGenerations(c *gin.Context) {
	if !s.isAdmin(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, strconv.IntSize)
	if err != nil || id == 0 {
		bad(c, 400, "用户编号无效")
		return
	}
	kind := c.DefaultQuery("kind", "all")
	if kind != "all" && kind != "recipes" && kind != "dishes" {
		bad(c, 400, "仅支持菜谱或菜品")
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "12"))
	if err != nil || limit < 1 || limit > 50 {
		bad(c, 400, "每页数量应为 1 至 50")
		return
	}
	offset, err := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if err != nil || offset < 0 {
		bad(c, 400, "分页位置无效")
		return
	}
	var user model.User
	if err := s.DB.First(&user, uint(id)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			bad(c, 404, "用户不存在")
		} else {
			bad(c, 500, "读取用户失败")
		}
		return
	}
	kinds := []string{"recipes", "dishes"}
	if kind != "all" {
		kinds = []string{kind}
	}
	query := s.DB.Model(&model.Document{}).Where("user_id = ? AND kind IN ?", user.ID, kinds)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		bad(c, 500, "读取生成记录失败")
		return
	}
	var documents []model.Document
	if err := query.Order("COALESCE(generated_at, created_at) desc, id desc").Limit(limit).Offset(offset).Find(&documents).Error; err != nil {
		bad(c, 500, "读取生成记录失败")
		return
	}
	items := make([]map[string]any, 0, len(documents))
	for _, doc := range documents {
		data, err := repository.DocumentData(doc)
		if err != nil {
			bad(c, 500, "生成记录内容无效")
			return
		}
		// Use the stored kind instead of trusting a field in document JSON.
		data["kind"] = doc.Kind
		items = append(items, data)
	}
	c.JSON(200, gin.H{"user": user, "items": items, "total": total, "limit": limit, "offset": offset, "has_more": int64(offset)+int64(len(items)) < total})
}
