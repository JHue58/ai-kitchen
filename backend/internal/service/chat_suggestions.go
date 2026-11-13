package service

import (
	"ai-kitchen/internal/model"
	"strings"
)

// Suggestions are optional enrichment: malformed buttons must not spoil a meal.
func cleanChatSuggestions(items []model.ChatSuggestion) []model.ChatSuggestion {
	result := []model.ChatSuggestion{}
	seen := map[string]bool{}
	for _, item := range items {
		item.Label, item.Message = strings.TrimSpace(item.Label), strings.TrimSpace(item.Message)
		if item.Label == "" || item.Message == "" || len([]rune(item.Label)) > 20 || len([]rune(item.Message)) > 300 || seen[item.Label] || seen[item.Message] {
			continue
		}
		seen[item.Label], seen[item.Message] = true, true
		result = append(result, item)
		if len(result) == 5 {
			break
		}
	}
	return result
}
