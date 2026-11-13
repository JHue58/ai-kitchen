package handler

import (
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"strconv"
	"strings"
)

// Filtering is owner-scoped by list before applying these independent collection filters.
func filterCollection(items []map[string]any, c *gin.Context, kind string) []map[string]any {
	out := []map[string]any{}
	for _, v := range items {
		name, _ := v["title"].(string)
		cost, _ := v["total_cost"].(float64)
		if kind == "dishes" {
			name, _ = v["name"].(string)
			cost, _ = v["cost"].(float64)
		}
		if !strings.Contains(strings.ToLower(name), strings.ToLower(strings.TrimSpace(c.Query("q")))) {
			continue
		}
		if c.Query("saved") == "true" && v["saved"] != true {
			continue
		}
		if c.Query("favorite") == "true" && v["favorite"] != true {
			continue
		}
		if n, err := strconv.Atoi(c.Query("servings")); err == nil && v["servings"] != float64(n) {
			continue
		}
		if n, err := strconv.ParseFloat(c.Query("min_cost"), 64); err == nil && cost < n {
			continue
		}
		if n, err := strconv.ParseFloat(c.Query("max_cost"), 64); err == nil && cost > n {
			continue
		}
		tags := map[string]bool{}
		if ts, ok := v["tags"].([]any); ok {
			for _, t := range ts {
				if text, ok := t.(string); ok {
					tags[text] = true
				}
			}
		}
		match := true
		for _, t := range c.QueryArray("tag") {
			if !tags[t] {
				match = false
			}
		}
		if match {
			out = append(out, v)
		}
	}
	return out
}

func (s *Server) saveDish(c *gin.Context) {
	d, ok := s.owned(c, "recipes")
	if !ok {
		return
	}
	var menu model.Recipe
	if json.Unmarshal([]byte(d.Data), &menu) != nil {
		bad(c, 500, "菜单数据无效")
		return
	}
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 || index >= len(menu.Dishes) {
		bad(c, 400, "菜品不存在")
		return
	}
	q := menu.Request
	q.Target = "dish"
	q.DishCount = 1
	dish := model.DishRecord{Dish: menu.Dishes[index], Servings: menu.Servings, Saved: true, Warnings: menu.Warnings, Sources: menu.Sources, Request: q}
	saved, created, err := repository.SaveDishSnapshot(s.DB, uid(c), dish)
	if err != nil {
		bad(c, 500, "保存失败")
		return
	}
	c.JSON(200, gin.H{"id": saved.ID, "saved": true, "already_saved": !created})
}
