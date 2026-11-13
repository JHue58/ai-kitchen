package service

import (
	"ai-kitchen/internal/calculator"
	"ai-kitchen/internal/model"
	"encoding/json"
	"fmt"
	"strings"
)

// Check required fields before Go decoding: Unmarshal otherwise silently treats
// missing fields and null numbers/strings as usable zero values.
func parseGeneratedRecipe(raw []byte) (model.Recipe, error) {
	if err := checkOutputObject(raw, "$", "title tags summary servings dishes energy_usage ai_commentary tips substitutions"); err != nil {
		return model.Recipe{}, err
	}
	r, err := calculator.Parse(raw)
	if err != nil {
		return r, err
	}
	if strings.TrimSpace(r.Title) == "" || len(r.Tags) == 0 {
		return r, fmt.Errorf("菜单 title 和 tags 不得为空")
	}
	for di, dish := range r.Dishes {
		if strings.TrimSpace(dish.Name) == "" || len(dish.Tags) == 0 {
			return r, fmt.Errorf("dishes[%d] 的 name 和 tags 不得为空", di)
		}
		if strings.TrimSpace(dish.Commentary) == "" {
			return r, fmt.Errorf("dishes[%d].ai_commentary 不得为空，请分别点评每道菜", di)
		}
		for ii, ingredient := range dish.Ingredients {
			if ingredient.Category != "main" && ingredient.Category != "supporting" && ingredient.Category != "seasoning" {
				return r, fmt.Errorf("dishes[%d].ingredients[%d].category 必须为 main、supporting 或 seasoning", di, ii)
			}
		}
		for si, step := range dish.Steps {
			if step.Step != si+1 || strings.TrimSpace(step.Title) == "" || strings.TrimSpace(step.Description) == "" {
				return r, fmt.Errorf("dishes[%d].steps[%d] 必须有标题、描述且 step 从 1 连续编号", di, si)
			}
		}
	}
	return r, nil
}

func checkOutputObject(raw json.RawMessage, path, fields string) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return fmt.Errorf("%s 必须为 JSON 对象", path)
	}
	for _, field := range strings.Fields(fields) {
		nullable := strings.HasSuffix(field, "?")
		key := strings.TrimSuffix(field, "?")
		value, ok := obj[key]
		if !ok || !nullable && string(value) == "null" {
			return fmt.Errorf("%s.%s 为必填字段且类型必须符合输出契约", path, key)
		}
		if string(value) == "null" {
			continue
		}
		childFields, array := "", false
		switch key {
		case "dishes":
			childFields, array = "image? tags name description ingredients equipment prep_minutes cook_minutes steps ai_commentary energy_usage", true
		case "ingredients":
			childFields, array = "name category quantity unit estimated_edible_weight_g? estimated_price_per_kg? nutrition_per_100g?", true
		case "steps":
			childFields, array = "step title description duration_minutes start_minute equipment_id temperature_c? power_level safety_note", true
		case "energy_usage":
			childFields, array = "equipment_id heating_minutes duty_cycle?", true
		case "image":
			childFields = "url source_url title credit license"
		case "nutrition_per_100g":
			childFields = "calories protein fat carbs"
		case "tags", "equipment", "tips", "substitutions":
			array = true
		}
		if array {
			var items []json.RawMessage
			if err := json.Unmarshal(value, &items); err != nil || items == nil {
				return fmt.Errorf("%s.%s 必须为数组", path, key)
			}
			for i, item := range items {
				if string(item) == "null" {
					return fmt.Errorf("%s.%s[%d] 不允许为 null", path, key, i)
				}
				if childFields != "" {
					if err := checkOutputObject(item, fmt.Sprintf("%s.%s[%d]", path, key, i), childFields); err != nil {
						return err
					}
				}
			}
		} else if childFields != "" {
			if err := checkOutputObject(value, path+"."+key, childFields); err != nil {
				return err
			}
		}
	}
	return nil
}
