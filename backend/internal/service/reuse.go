package service

import (
	"ai-kitchen/internal/ai"
	"ai-kitchen/internal/calculator"
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"gorm.io/gorm"
)

type existingDish struct {
	Reference model.DishReference `json:"reference"`
	MenuTitle string              `json:"menu_title,omitempty"`
	Servings  int                 `json:"servings"`
	Dish      model.Dish          `json:"dish"`
	Sources   []model.Source      `json:"-"`
}

func dishesInDocument(doc model.Document) ([]existingDish, error) {
	out := []existingDish{}
	if doc.Kind == "dishes" {
		var r model.DishRecord
		if err := json.Unmarshal([]byte(doc.Data), &r); err != nil {
			return nil, err
		}
		menu := model.Recipe{Dishes: []model.Dish{r.Dish}}
		calculator.NormalizeRecipeDetails(&menu)
		r.Dish = menu.Dishes[0]
		out = append(out, existingDish{Reference: model.DishReference{Kind: doc.Kind, ID: doc.ID}, Servings: r.Servings, Dish: r.Dish, Sources: r.Sources})
	} else {
		var r model.Recipe
		if err := json.Unmarshal([]byte(doc.Data), &r); err != nil {
			return nil, err
		}
		calculator.NormalizeRecipeDetails(&r)
		for i, dish := range r.Dishes {
			out = append(out, existingDish{Reference: model.DishReference{Kind: doc.Kind, ID: doc.ID, DishIndex: i}, MenuTitle: r.Title, Servings: r.Servings, Dish: dish, Sources: r.Sources})
		}
	}
	for i := range out {
		out[i].Dish.ReuseFrom = nil
	}
	return out, nil
}

func existingDishTool(db *gorm.DB, uid uint, q model.Request) ai.Tool {
	properties := map[string]any{}
	for _, key := range []string{"query", "kind"} {
		properties[key] = map[string]any{"type": "string"}
	}
	for _, key := range []string{"ingredients", "exclude_ingredients", "tags"} {
		properties[key] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}}
	}
	for _, key := range []string{"max_cost", "max_minutes"} {
		properties[key] = map[string]any{"type": "number", "minimum": 0}
	}
	for _, key := range []string{"servings", "offset", "limit"} {
		properties[key] = map[string]any{"type": "integer", "minimum": 0}
	}
	return ai.Tool{Name: "search_existing_dishes", Required: true,
		Description: `搜索当前用户已生成的独立菜品和菜单中的菜品，返回完整做法和可直接复用的 reference。query 匹配菜名、描述或菜单名；ingredients/tags 为全部匹配，食材支持部分名称；exclude_ingredients 排除食材；kind 可为 dishes/recipes，空为全部；servings 默认本次人数；max_cost/max_minutes 为单菜上限。各条件取交集，空条件不限。offset/limit 分页，默认10条最多20条，total 为总命中数。可多次调整筛选。复用时输出 {"reuse_from": reference}，无需重写菜谱；菜单可组合多个历史菜品和新菜。`,
		Parameters:  map[string]any{"type": "object", "properties": properties, "additionalProperties": false},
		Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var a struct {
				Query       string   `json:"query"`
				Kind        string   `json:"kind"`
				Ingredients []string `json:"ingredients"`
				Exclude     []string `json:"exclude_ingredients"`
				Tags        []string `json:"tags"`
				Servings    int      `json:"servings"`
				MaxCost     *float64 `json:"max_cost"`
				MaxMinutes  *float64 `json:"max_minutes"`
				Offset      int      `json:"offset"`
				Limit       int      `json:"limit"`
			}
			if err := json.Unmarshal(raw, &a); err != nil {
				return nil, err
			}
			if a.Kind != "" && a.Kind != "dishes" && a.Kind != "recipes" {
				return nil, fmt.Errorf("kind 必须为 dishes 或 recipes")
			}
			if a.Offset < 0 || a.Limit < 0 || a.Limit > 20 || a.Servings < 0 || a.Servings > 10 || a.MaxCost != nil && *a.MaxCost < 0 || a.MaxMinutes != nil && *a.MaxMinutes < 0 {
				return nil, fmt.Errorf("筛选数值超出范围")
			}
			if a.Limit == 0 {
				a.Limit = 10
			}
			if a.Servings == 0 {
				a.Servings = q.Servings
			}
			query := db.WithContext(ctx).Where("user_id = ? AND kind IN ?", uid, []string{"dishes", "recipes"})
			if a.Kind != "" {
				query = query.Where("kind = ?", a.Kind)
			}
			matches := []existingDish{}
			total := 0
			// Scan in batches so collection size does not determine database memory use.
			lastID := uint(0)
			for {
				var docs []model.Document
				if err := query.Where("id > ?", lastID).Order("id asc").Limit(100).Find(&docs).Error; err != nil {
					return nil, err
				}
				if len(docs) == 0 {
					break
				}
				for _, doc := range docs {
					if err := ctx.Err(); err != nil {
						return nil, err
					}
					candidates, err := dishesInDocument(doc)
					if err != nil {
						continue
					}
					for _, item := range candidates {
						d := item.Dish
						if a.Servings > 0 && item.Servings != a.Servings {
							continue
						}
						if !containsText(d.Name+" "+d.Description+" "+item.MenuTitle, a.Query) {
							continue
						}
						if a.MaxCost != nil && d.Cost > *a.MaxCost || a.MaxMinutes != nil && d.PrepMinutes+d.CookMinutes > *a.MaxMinutes {
							continue
						}
						ingredientNames := []string{}
						for _, in := range d.Ingredients {
							ingredientNames = append(ingredientNames, in.Name)
						}
						if !allMatch(ingredientNames, a.Ingredients, false) || !allMatch(d.Tags, a.Tags, true) {
							continue
						}
						excluded := false
						for _, word := range a.Exclude {
							if strings.TrimSpace(word) != "" && allMatch(ingredientNames, []string{word}, false) {
								excluded = true
							}
						}
						if !excluded && len(d.Ingredients) > 0 && len(d.Steps) > 0 {
							if total >= a.Offset && len(matches) < a.Limit {
								matches = append(matches, item)
							}
							total++
						}
					}
				}
				lastID = docs[len(docs)-1].ID
			}
			return map[string]any{"items": matches, "total": total, "has_more": a.Offset < total && len(matches) < total-a.Offset}, nil
		}}
}

func containsText(text, term string) bool {
	return strings.Contains(strings.ToLower(text), strings.ToLower(strings.TrimSpace(term)))
}
func allMatch(values, terms []string, exact bool) bool {
	for _, term := range terms {
		found := false
		for _, value := range values {
			if exact && strings.EqualFold(value, strings.TrimSpace(term)) || !exact && containsText(value, term) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// Expand references before both check_menu and final validation. IDs always remain owner-scoped.
func parseRecipeWithReuse(ctx context.Context, db *gorm.DB, uid uint, q model.Request, raw []byte) (model.Recipe, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return model.Recipe{}, err
	}
	var dishes []json.RawMessage
	if err := json.Unmarshal(root["dishes"], &dishes); err != nil {
		return model.Recipe{}, err
	}
	sources := []model.Source{}
	for i, rawDish := range dishes {
		var entry struct {
			Reference *model.DishReference `json:"reuse_from"`
		}
		if err := json.Unmarshal(rawDish, &entry); err != nil {
			return model.Recipe{}, err
		}
		ref := entry.Reference
		if ref == nil {
			continue
		}
		if !q.ReuseEnabled() {
			return model.Recipe{}, fmt.Errorf("历史菜品复用已关闭")
		}
		if ref.ID == 0 || ref.DishIndex < 0 || ref.StartOffset < 0 || math.IsNaN(ref.StartOffset) || math.IsInf(ref.StartOffset, 0) || ref.Kind != "dishes" && ref.Kind != "recipes" {
			return model.Recipe{}, fmt.Errorf("历史菜品引用无效")
		}
		var doc model.Document
		if err := db.WithContext(ctx).Where("id = ? AND user_id = ? AND kind = ?", ref.ID, uid, ref.Kind).First(&doc).Error; err != nil {
			return model.Recipe{}, fmt.Errorf("历史菜品不存在或不可访问")
		}
		candidates, err := dishesInDocument(doc)
		if err != nil {
			return model.Recipe{}, err
		}
		if ref.DishIndex >= len(candidates) {
			return model.Recipe{}, fmt.Errorf("历史菜品序号无效")
		}
		item := candidates[ref.DishIndex]
		if item.Servings != q.Servings {
			return model.Recipe{}, fmt.Errorf("历史菜品人数不符，请选择人数相同的菜品或重新生成")
		}
		dish := item.Dish
		dish.ReuseFrom = ref
		// Preserve the original relative timeline; allow shifting it to avoid equipment conflicts.
		for si := range dish.Steps {
			dish.Steps[si].Start += ref.StartOffset
		}
		dishes[i], err = json.Marshal(dish)
		if err != nil {
			return model.Recipe{}, err
		}
		// The generation contract requires image even when the stored API omitted it.
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(dishes[i], &fields); err != nil {
			return model.Recipe{}, err
		}
		if dish.Image == nil {
			fields["image"] = json.RawMessage("null")
		}
		dishes[i], err = json.Marshal(fields)
		if err != nil {
			return model.Recipe{}, err
		}
		sources = append(sources, item.Sources...)
	}
	root["dishes"], _ = json.Marshal(dishes)
	expanded, err := json.Marshal(root)
	if err != nil {
		return model.Recipe{}, err
	}
	recipe, err := parseGeneratedRecipe(expanded)
	recipe.Sources = sources
	return recipe, err
}
