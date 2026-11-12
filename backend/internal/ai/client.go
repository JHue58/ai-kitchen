package ai

import (
	"ai-kitchen/internal/config"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func Post(ctx context.Context, base, path, key string, body any, out any) error {
	b, e := json.Marshal(body)
	if e != nil {
		return e
	}
	for attempt := 0; attempt < 3; attempt++ {
		logger := Logger(ctx).With("attempt", attempt+1)
		started := time.Now()
		logger.Info("llm.request.started")
		req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(base, "/")+path, bytes.NewReader(b))
		if e != nil {
			return fmt.Errorf("API 地址配置无效")
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		res, e := (&http.Client{Timeout: 150 * time.Second}).Do(req)
		if e != nil {
			logger.Error("llm.connection.failed", "error", e)
			return fmt.Errorf("上游连接失败或超时")
		}
		data, er := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		res.Body.Close()
		if er != nil {
			logger.Error("llm.read.failed", "error", er)
			return fmt.Errorf("上游响应读取失败")
		}
		logger.Info("llm.response", "status", res.StatusCode, "bytes", len(data), "duration", time.Since(started))
		if res.StatusCode == 200 {
			if path == "/chat/completions" {
				recordUsage(ctx, data)
			}
			if err := json.Unmarshal(data, out); err != nil {
				logger.Error("llm.decode.failed", "error", err)
				return fmt.Errorf("上游响应格式无效")
			}
			return nil
		}
		logger.Error("llm.http.failed", "status", res.StatusCode)
		if res.StatusCode == 401 {
			return fmt.Errorf("API Key 配置错误，请联系管理员")
		}
		if res.StatusCode == 402 {
			return fmt.Errorf("API 余额不足")
		}
		if attempt < 2 && (res.StatusCode == 408 || res.StatusCode == 429 || res.StatusCode >= 500) {
			logger.Warn("llm.retry", "delay", time.Duration(1<<attempt)*time.Second)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * time.Second):
				continue
			}
		}
		return fmt.Errorf("上游请求失败（HTTP %d）", res.StatusCode)
	}
	return fmt.Errorf("上游暂时不可用")
}
func Chat(ctx context.Context, c config.Config, system string, content any) ([]byte, error) {
	if !c.LLM.Enabled || c.LLM.APIKey == "" || c.LLM.Model == "" {
		return nil, fmt.Errorf("尚未配置 AI 服务，请管理员设置后端 config.yaml")
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	args := map[string]any{
		"model":           c.LLM.Model,
		"temperature":     c.LLM.Temperature,
		"max_tokens":      c.LLM.MaxTokens,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []any{map[string]any{"role": "system", "content": system},
			map[string]any{"role": "user", "content": content}},
	}

	if c.LLM.MaxTokens <= 0 {
		delete(args, "max_tokens")
	}

	e := Post(ctx, c.LLM.BaseURL, "/chat/completions", c.LLM.APIKey, args, &out)
	if e != nil {
		return nil, e
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("模型未返回内容")
	}
	return []byte(out.Choices[0].Message.Content), nil
}
