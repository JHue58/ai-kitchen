package search

import (
	"ai-kitchen/internal/ai"
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"
)

func SafeURL(s string) bool {
	u, e := url.Parse(s)
	if e != nil || u.User != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || !strings.Contains(h, ".") || strings.HasSuffix(h, ".local") {
		return false
	}
	if ip := net.ParseIP(h); ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast()) {
		return false
	}
	return true
}
func Run(ctx context.Context, db *gorm.DB, c config.Config, query string, job uint) ([]model.Source, error) {
	if !c.Search.Enabled || c.Search.APIKey == "" {
		return nil, fmt.Errorf("联网服务未配置，已回退纯模型生成")
	}
	chars := []rune(query)
	if len(chars) > 128 {
		query = string(chars[:128])
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s|%+v|%s", query, c.Search.ResultCount, c.Search.Localization))))
	var cached model.Cache
	if db.First(&cached, "key = ? AND expires_at > ?", key, time.Now()).Error == nil {
		var sources []model.Source
		if json.Unmarshal([]byte(cached.Data), &sources) == nil {
			return sources, nil
		}
	}
	var out struct {
		Results []model.Source `json:"results"`
	}
	db.Model(&model.Job{}).Where("id = ?", job).UpdateColumn("search_calls", gorm.Expr("search_calls + 1"))
	if e := ai.Post(ctx, c.Search.BaseURL, "/v1/tools/search", c.Search.APIKey, map[string]any{"query": query, "ori_question": query, "count": c.Search.ResultCount, "need_content": c.Search.NeedContent, "localization": c.Search.Localization}, &out); e != nil {
		return nil, e
	}
	sort.SliceStable(out.Results, func(i, j int) bool { return out.Results[i].Score > out.Results[j].Score })

	result := []model.Source{}
	for _, s := range out.Results {
		if !SafeURL(s.URL) {
			continue
		}
		runes := []rune(s.Content)
		if len(runes) > 8000 {
			s.Content = string(runes[:8000])
		}
		result = append(result, s)
		if len(result) >= c.Search.ResultCount {
			break
		}
	}
	b, _ := json.Marshal(result)
	db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model.Cache{Key: key, Data: string(b), ExpiresAt: time.Now().Add(time.Duration(c.Search.CacheTTLMinutes) * time.Minute)})
	return result, nil
}

// Fetch is separate from search: the agent decides which discovered page needs reading.
func Fetch(ctx context.Context, db *gorm.DB, c config.Config, target string, job uint) (string, error) {
	if !c.Search.Enabled || c.Search.APIKey == "" {
		return "", fmt.Errorf("联网服务未配置")
	}
	if !SafeURL(target) {
		return "", fmt.Errorf("网页地址不安全")
	}
	key := fmt.Sprintf("fetch:%x", sha256.Sum256([]byte(target)))
	var cached model.Cache
	if db.First(&cached, "key = ? AND expires_at > ?", key, time.Now()).Error == nil {
		return cached.Data, nil
	}
	db.Model(&model.Job{}).Where("id = ?", job).UpdateColumn("fetch_calls", gorm.Expr("fetch_calls + 1"))
	var out struct {
		Content string `json:"content"`
	}
	if err := ai.Post(ctx, c.Search.BaseURL, "/v1/tools/fetch", c.Search.APIKey, map[string]string{"url": target}, &out); err != nil {
		return "", err
	}
	runes := []rune(out.Content)
	if len(runes) > 8000 {
		out.Content = string(runes[:8000])
	}
	db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model.Cache{Key: key, Data: out.Content, ExpiresAt: time.Now().Add(time.Duration(c.Search.CacheTTLMinutes) * time.Minute)})
	return out.Content, nil
}
