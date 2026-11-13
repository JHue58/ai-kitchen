package handler

import (
	"ai-kitchen/internal/service"
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (s *Server) recipeChat(c *gin.Context) {
	kind := c.Param("kind")
	if kind == "" {
		kind = "recipes"
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 || kind != "recipes" && kind != "dishes" {
		bad(c, 404, "菜谱不存在")
		return
	}
	visitID := c.Query("visit_id")
	if visitID == "" || len(visitID) > 80 {
		bad(c, 400, "页面会话已失效，请重新打开菜谱")
		return
	}
	if c.Request.Method == "DELETE" {
		if err := service.CloseRecipeChat(s.DB, uid(c), kind, uint(id), visitID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				bad(c, 404, "菜谱不存在")
			} else {
				bad(c, 500, "清空对话失败")
			}
			return
		}
		c.JSON(200, gin.H{"ok": true})
		return
	}
	if c.Request.Method == "GET" {
		state, err := service.GetRecipeChat(s.DB, uid(c), kind, uint(id), visitID)
		if err != nil {
			if errors.Is(err, service.ErrChatClosed) {
				bad(c, 410, err.Error())
			} else if errors.Is(err, gorm.ErrRecordNotFound) {
				bad(c, 404, "菜谱不存在")
			} else {
				bad(c, 500, "读取对话失败")
			}
			return
		}
		c.JSON(200, state)
		return
	}
	var input struct {
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
	}
	if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Message) == "" || len([]rune(input.Message)) > 2000 || len(input.RequestID) > 80 {
		bad(c, 400, "请输入 1 至 2000 字的问题或调整要求")
		return
	}
	if !s.C.LLM.Enabled || s.C.LLM.APIKey == "" || s.C.LLM.Model == "" {
		bad(c, 503, "尚未配置 AI 服务，请管理员设置后端 config.yaml")
		return
	}
	if !s.limit("recipe-chat:"+strconv.Itoa(int(uid(c))), 30) {
		bad(c, 429, "提问较频繁，请稍后再试")
		return
	}
	// Accepted turns finish even when navigation disconnects the browser. Keep a
	// bounded lifetime so the same visit can poll its saved result after returning.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), service.RecipeChatTimeout(s.C))
	defer cancel()
	result, err := service.ReplyRecipeChat(ctx, s.DB, s.C, uid(c), kind, uint(id), strings.TrimSpace(input.Message), input.RequestID, visitID)
	if err != nil {
		code := 502
		if errors.Is(err, gorm.ErrRecordNotFound) {
			code = 404
		}
		if errors.Is(err, service.ErrChatBusy) || errors.Is(err, service.ErrChatConflict) {
			code = 409
		}
		if errors.Is(err, service.ErrChatClosed) {
			code = 410
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = 504
		}
		bad(c, code, err.Error())
		return
	}
	c.JSON(200, result)
}
