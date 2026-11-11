package config

import (
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"reflect"
	"strconv"
	"strings"
)

type Config struct {
	Server struct {
		Host      string
		Port      int
		Mode      string
		StaticDir string `yaml:"static_dir"`
	}
	Database struct {
		Driver string
		DSN    string
	}
	Auth struct {
		AllowRegistration bool   `yaml:"allow_registration"`
		InviteCode        string `yaml:"invite_code"`
		SessionTTLHours   int    `yaml:"session_ttl_hours"`
		SecureCookie      bool   `yaml:"secure_cookie"`
	}
	LLM struct {
		Enabled        bool
		BaseURL        string `yaml:"base_url"`
		APIKey         string `yaml:"api_key"`
		Model          string
		TimeoutSeconds int `yaml:"timeout_seconds"`
		Temperature    float64
		MaxTokens      int  `yaml:"max_tokens"`
		VisionEnabled  bool `yaml:"vision_enabled"`
	}
	Search struct {
		Enabled         bool
		BaseURL         string `yaml:"base_url"`
		APIKey          string `yaml:"api_key"`
		DefaultEnabled  bool   `yaml:"default_enabled"`
		ResultCount     int    `yaml:"result_count"`
		NeedContent     bool   `yaml:"need_content"`
		MaxFetchPages   int    `yaml:"max_fetch_pages"`
		CacheTTLMinutes int    `yaml:"cache_ttl_minutes"`
		Localization    string
	} `yaml:"deepseek_search"`
	Storage struct {
		UploadDir   string `yaml:"upload_dir"`
		MaxUploadMB int    `yaml:"max_upload_mb"`
	}
}

func Load(path string) (Config, error) {
	var c Config
	c.Server.Host = "127.0.0.1"
	c.Server.Port = 8080
	c.Server.StaticDir = "../frontend/dist"
	c.Database.Driver = "sqlite"
	c.Database.DSN = "data/kitchen.db"
	c.Auth.AllowRegistration = true
	c.Auth.SessionTTLHours = 168
	c.LLM.BaseURL = "https://api.deepseek.com"
	c.LLM.TimeoutSeconds = 120
	c.LLM.MaxTokens = 8000
	c.LLM.Temperature = .7
	c.Search.BaseURL = "https://api.deepseek.com"
	c.Search.ResultCount = 5
	c.Search.MaxFetchPages = 2
	c.Search.CacheTTLMinutes = 1440
	c.Search.NeedContent = true
	c.Storage.UploadDir = "data/uploads"
	c.Storage.MaxUploadMB = 10
	b, e := os.ReadFile(path)
	if e != nil {
		return c, e
	}
	if e = yaml.Unmarshal(b, &c); e != nil {
		return c, e
	}
	if e = env(reflect.ValueOf(&c).Elem(), "KITCHEN"); e != nil {
		return c, e
	}
	if c.Server.Port < 1 || c.Server.Port > 65535 || c.Auth.SessionTTLHours < 1 || c.LLM.TimeoutSeconds < 1 || c.Storage.MaxUploadMB < 1 || c.Storage.MaxUploadMB > 30 || c.Search.ResultCount < 1 || c.Search.ResultCount > 50 || c.Search.MaxFetchPages < 0 || c.Search.MaxFetchPages > 10 {
		return c, fmt.Errorf("配置数值超出范围")
	}
	return c, nil
}
func env(v reflect.Value, p string) error {
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		name := t.Field(i).Tag.Get("yaml")
		if name == "" {
			name = strings.ToLower(t.Field(i).Name)
		}
		key := p + "_" + strings.ToUpper(name)
		if f.Kind() == reflect.Struct {
			if e := env(f, key); e != nil {
				return e
			}
			continue
		}
		s, ok := os.LookupEnv(key)
		if !ok {
			continue
		}
		switch f.Kind() {
		case reflect.String:
			f.SetString(s)
		case reflect.Bool:
			n, e := strconv.ParseBool(s)
			if e != nil {
				return fmt.Errorf("环境变量 %s 无效", key)
			}
			f.SetBool(n)
		case reflect.Int:
			n, e := strconv.ParseInt(s, 10, 64)
			if e != nil {
				return fmt.Errorf("环境变量 %s 无效", key)
			}
			f.SetInt(n)
		case reflect.Float64:
			n, e := strconv.ParseFloat(s, 64)
			if e != nil {
				return e
			}
			f.SetFloat(n)
		}
	}
	return nil
}
