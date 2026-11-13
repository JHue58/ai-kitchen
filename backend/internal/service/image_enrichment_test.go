package service

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func imageTestConfig(t *testing.T, upstream string) config.Config {
	t.Helper()
	var c config.Config
	c.Database.Driver = "sqlite"
	c.Database.DSN = filepath.Join(t.TempDir(), "images.db")
	c.LLM.Enabled, c.LLM.VisionEnabled = true, true
	c.LLM.APIKey, c.LLM.Model, c.LLM.BaseURL = "test", "vision", upstream
	c.LLM.TimeoutSeconds = 5
	c.Images.TimeoutSeconds = 1
	c.Search.Enabled, c.Search.NeedContent = true, true
	c.Search.APIKey, c.Search.BaseURL = "test", upstream
	c.Search.ResultCount = 5
	return c
}

func TestImageAgentSharesOneBatchAndBindsDishIndexes(t *testing.T) {
	var planning, vision, searches atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path == "/v1/tools/search" {
			searches.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"results": []model.Source{{URL: "https://example.com/recipe", Content: "![第一道](https://example.com/one.jpg) ![第二道](https://example.com/two.jpg)"}}})
			return
		}
		messages, _ := json.Marshal(body["messages"])
		if strings.Contains(string(messages), "image_url") {
			call := vision.Add(1)
			if call == 1 && !strings.Contains(string(messages), "第一道：") || call == 2 && !strings.Contains(string(messages), "第二道：") {
				t.Error("vision was not bound to the saved dish at the requested index")
			}
			imageTestReply(w, `{"description":"清晰成品","matches":true,"clear":true,"reason":"匹配"}`, "", "")
			return
		}
		call := planning.Add(1)
		if !strings.Contains(string(messages), "第一道") || !strings.Contains(string(messages), "第二道") {
			t.Error("agent did not receive both dishes in the shared context")
		}
		switch call {
		case 1:
			imageTestReply(w, "", "search_web", `{"query":"第一道 第二道 成品图","origin_question":"为这两道菜找图"}`)
		case 2:
			imageTestReply(w, "", "view_image", `{"url":"https://example.com/one.jpg","dish_index":99}`)
		case 3:
			if !strings.Contains(string(messages), "有效索引") {
				t.Error("invalid index was not returned to the agent")
			}
			imageTestReply(w, "", "view_image", `{"url":"https://example.com/one.jpg","dish_index":0}`)
		case 4:
			imageTestReply(w, "", "view_image", `{"url":"https://example.com/two.jpg","dish_index":1}`)
		default:
			t.Error("agent unnecessarily restarted or requested another round after completion")
			imageTestReply(w, "{}", "", "")
		}
	}))
	defer upstream.Close()
	c := imageTestConfig(t, upstream.URL)
	c.Images.TimeoutSeconds = 5
	db, err := repository.Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	var recipe model.Recipe
	json.Unmarshal([]byte(validGeneratedRecipe), &recipe)
	recipe.Request.Search = true
	recipe.Dishes[0].Name = "第一道"
	second := recipe.Dishes[0]
	second.Name = "第二道"
	recipe.Dishes = append(recipe.Dishes, second)
	doc, _ := Save(db, 1, "recipes", recipe)
	enrichImages(context.Background(), db, c, model.Job{}, doc, recipe)
	db.First(&doc, doc.ID)
	json.Unmarshal([]byte(doc.Data), &recipe)
	if planning.Load() != 4 || searches.Load() != 1 || vision.Load() != 2 || recipe.ImageStatus != "completed" || recipe.Dishes[0].Image == nil || recipe.Dishes[1].Image == nil {
		t.Fatalf("batch did not complete: planning=%d search=%d vision=%d recipe=%s", planning.Load(), searches.Load(), vision.Load(), doc.Data)
	}
}

func imageTestReply(w http.ResponseWriter, content, tool, args string) {
	message := map[string]any{"content": content}
	if tool != "" {
		message["tool_calls"] = []any{map[string]any{"id": tool, "type": "function", "function": map[string]string{"name": tool, "arguments": args}}}
	}
	json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
}

func TestMenuDeliveredBeforeImageSearch(t *testing.T) {
	for _, target := range []string{"menu", "dish"} {
		t.Run(target, func(t *testing.T) {
			searchStarted, release := make(chan struct{}), make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				json.NewDecoder(r.Body).Decode(&body)
				if r.URL.Path == "/v1/tools/search" {
					if strings.Contains(body["query"].(string), "成品图") {
						close(searchStarted)
						select {
						case <-release:
						case <-r.Context().Done():
							return
						}
					}
					json.NewEncoder(w).Encode(map[string]any{"results": []model.Source{{URL: "https://example.com/recipe", Content: "![鸡蛋](https://example.com/eggs.jpg)"}}})
					return
				}
				messages, _ := json.Marshal(body["messages"])
				if strings.Contains(string(messages), "image_url") {
					if strings.Contains(string(messages), "模型提供的其他名称") {
						t.Error("visual assessment was not bound to the saved dish")
					}
					imageTestReply(w, `{"description":"炒鸡蛋","matches":true,"clear":true,"reason":"清晰匹配"}`, "", "")
					return
				}
				tools, _ := json.Marshal(body["tools"])
				if !strings.Contains(string(tools), "check_menu") {
					if !strings.Contains(strings.ToLower(string(messages)), "json") {
						http.Error(w, "JSON mode requires the word json in messages", http.StatusBadRequest)
						return
					}
					if !strings.Contains(string(messages), `"tool_call_id":"search_web"`) {
						imageTestReply(w, "", "search_web", `{"query":"鸡蛋 成品图","origin_question":"给炒鸡蛋配图"}`)
					} else {
						imageTestReply(w, "", "view_image", `{"url":"https://example.com/eggs.jpg","dish_index":0}`)
					}
					return
				}
				if strings.Contains(string(tools), "view_image") {
					t.Error("menu generation exposed visual tool")
				}
				if !strings.Contains(string(messages), `"tool_call_id":"search_web"`) {
					imageTestReply(w, "", "search_web", `{"query":"鸡蛋 做法"}`)
				} else if !strings.Contains(string(messages), `"tool_call_id":"check_menu"`) {
					args, _ := json.Marshal(map[string]string{"recipe": validGeneratedRecipe})
					imageTestReply(w, "", "check_menu", string(args))
				} else {
					imageTestReply(w, validGeneratedRecipe, "", "")
				}
			}))
			defer upstream.Close()
			c := imageTestConfig(t, upstream.URL)
			c.Images.TimeoutSeconds = 5
			db, err := repository.Open(c)
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			defer sqlDB.Close()
			user := model.User{Username: "chef"}
			db.Create(&user)
			q := model.Request{ReuseExisting: &reuseDisabledForLegacyTests, Target: target, Search: true, Servings: 2, Mode: "strict", Ingredients: []string{"鸡蛋"}, DishCount: 1}
			raw, _ := json.Marshal(q)
			job := model.Job{UserID: user.ID, Status: "pending", Request: string(raw)}
			db.Create(&job)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			run(ctx, db, c, job)
			select {
			case <-searchStarted:
			case <-time.After(3 * time.Second):
				t.Fatal("image task never searched")
			}
			db.First(&job, job.ID)
			if job.Status != "completed" || job.RecipeID == 0 {
				t.Fatalf("image search delayed delivery: %+v", job)
			}
			var doc model.Document
			db.First(&doc, job.RecipeID)
			if !strings.Contains(doc.Data, `"image_status":"pending"`) {
				t.Fatalf("missing image status: %s", doc.Data)
			}
			// An unrelated user edit made during the slow search must survive.
			patchImageDocument(db, doc, func(data map[string]any) { data["favorite"] = true })
			close(release)
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				db.First(&doc, doc.ID)
				if strings.Contains(doc.Data, `"image_status":"completed"`) {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if !strings.Contains(doc.Data, `"url":"https://example.com/eggs.jpg"`) || !strings.Contains(doc.Data, `"favorite":true`) || !strings.Contains(doc.Data, `"image_status":"completed"`) {
				t.Fatalf("background image not merged: %s", doc.Data)
			}
			if target == "menu" {
				var menu model.Recipe
				json.Unmarshal([]byte(doc.Data), &menu)
				var linked model.Document
				if menu.Dishes[0].CollectionID == 0 || db.First(&linked, menu.Dishes[0].CollectionID).Error != nil || !strings.Contains(linked.Data, `"url":"https://example.com/eggs.jpg"`) || !strings.Contains(linked.Data, `"image_status":"completed"`) {
					t.Fatalf("image did not reach automatically collected dish: %s", linked.Data)
				}
			}
			db.First(&job, job.ID)
			if job.Status != "completed" {
				t.Fatalf("image phase changed job: %+v", job)
			}
		})
	}
}

func TestImageTimeoutKeepsPartialImagesAndMenu(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path == "/v1/tools/search" {
			if strings.Contains(body["query"].(string), "第二道") {
				<-r.Context().Done()
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"results": []model.Source{{URL: "https://example.com/recipe", Content: "![鸡蛋](https://example.com/eggs.jpg)"}}})
			return
		}
		messages, _ := json.Marshal(body["messages"])
		if strings.Contains(string(messages), "image_url") {
			imageTestReply(w, `{"description":"鸡蛋","matches":true,"clear":true,"reason":"清晰"}`, "", "")
		} else if !strings.Contains(string(messages), `"tool_call_id":"search_web"`) {
			imageTestReply(w, "", "search_web", `{"query":"鸡蛋 成品图","origin_question":"第一道配图"}`)
		} else if !strings.Contains(string(messages), `"tool_call_id":"view_image"`) {
			imageTestReply(w, "", "view_image", `{"url":"https://example.com/eggs.jpg","dish_index":0}`)
		} else {
			imageTestReply(w, "", "search_web", `{"query":"第二道 成品图","origin_question":"第二道配图"}`)
		}
	}))
	defer upstream.Close()
	c := imageTestConfig(t, upstream.URL)
	db, err := repository.Open(c)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	var recipe model.Recipe
	json.Unmarshal([]byte(validGeneratedRecipe), &recipe)
	recipe.ImageStatus = "pending"
	recipe.Request.Search = true
	second := recipe.Dishes[0]
	second.Name = "第二道"
	recipe.Dishes = append(recipe.Dishes, second)
	doc, _ := Save(db, 1, "recipes", recipe)
	job := model.Job{UserID: 1, Status: "completed", RecipeID: doc.ID}
	db.Create(&job)
	started := time.Now()
	enrichImages(context.Background(), db, c, job, doc, recipe)
	if time.Since(started) > 3*time.Second {
		t.Fatal("image task ignored its own deadline")
	}
	db.First(&doc, doc.ID)
	json.Unmarshal([]byte(doc.Data), &recipe)
	if recipe.ImageStatus != "timed_out" || len(recipe.Dishes) != 2 || recipe.Dishes[0].Image == nil || recipe.Dishes[1].Image != nil {
		t.Fatalf("timeout discarded partial results: %s", doc.Data)
	}
	db.First(&job, job.ID)
	if job.Status != "completed" {
		t.Fatal("timeout failed a delivered menu")
	}
	interruptImageSearches(db)
	if err := patchImageDocument(db, doc, func(data map[string]any) { data["image_status"] = "pending" }); err != nil {
		t.Fatal(err)
	}
	interruptImageSearches(db)
	db.First(&doc, doc.ID)
	if !strings.Contains(doc.Data, `"image_status":"interrupted"`) || !strings.Contains(doc.Data, "eggs.jpg") {
		t.Fatal("restart lost the menu or left polling active")
	}
}
