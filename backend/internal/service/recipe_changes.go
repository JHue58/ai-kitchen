package service

import (
	"ai-kitchen/internal/ai"
	"ai-kitchen/internal/calculator"
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"

	"gorm.io/gorm"
)

type recipeChanges struct {
	kind        string
	current     map[string]any
	recipe      model.Recipe
	request     model.Request
	preferences model.Preferences
	equipment   []model.Equipment
	pantry      []model.Pantry
	prices      []model.Price
	dishes      map[int]bool
	baseline    map[string]bool
}

func copyRecipeMap(data map[string]any) map[string]any {
	raw, _ := json.Marshal(data)
	var copy map[string]any
	json.Unmarshal(raw, &copy)
	return copy
}

func decodeChatRecipe(data map[string]any, kind string) (model.Recipe, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return model.Recipe{}, err
	}
	if kind == "dishes" {
		var record model.DishRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return model.Recipe{}, err
		}
		r := model.Recipe{Title: record.Name, Servings: record.Servings, Dishes: []model.Dish{record.Dish}, Sources: record.Sources, Request: record.Request, Warnings: record.Warnings}
		raw, err = json.Marshal(r)
		if err != nil {
			return r, err
		}
	}
	return calculator.Parse(raw)
}

func newRecipeChanges(db *gorm.DB, userID uint, kind string, data map[string]any) (*recipeChanges, error) {
	r, err := decodeChatRecipe(data, kind)
	if err != nil {
		return nil, err
	}
	q := r.Request
	if q.Servings == 0 {
		q.Servings = r.Servings
	}
	if q.DishCount == 0 {
		q.DishCount = len(r.Dishes)
	}
	if kind == "dishes" {
		q.Target = "dish"
		q.DishCount = 1
	}
	equipment := Read[model.Equipment](db, userID, "equipment")
	if len(q.EquipmentIDs) > 0 {
		selected := []model.Equipment{}
		for _, e := range equipment {
			for _, id := range q.EquipmentIDs {
				if e.ID == id {
					selected = append(selected, e)
					break
				}
			}
		}
		equipment = selected
	}
	c := &recipeChanges{kind: kind, current: copyRecipeMap(data), recipe: r, request: q, preferences: Prefs(db, userID), equipment: equipment, pantry: Read[model.Pantry](db, userID, "pantry"), prices: Read[model.Price](db, userID, "prices"), dishes: map[int]bool{}, baseline: map[string]bool{}}
	for _, violation := range calculator.Validate(r, q, c.preferences, c.equipment, c.pantry) {
		c.baseline[violation] = true
	}
	return c, nil
}

var chatMenuFields = strings.Fields("title tags summary servings ai_commentary tips substitutions")
var chatDishFields = strings.Fields("name description tags ingredients equipment prep_minutes cook_minutes steps ai_commentary energy_usage chat_suggestions")

func patchFieldSchema(fields []string) map[string]any {
	properties := map[string]any{}
	for _, key := range fields {
		typeName := "string"
		switch key {
		case "tags", "tips", "substitutions":
			properties[key] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}}
			continue
		case "chat_suggestions":
			properties[key] = map[string]any{"type": "array", "maxItems": 5, "items": map[string]any{"type": "object", "properties": map[string]any{"label": map[string]string{"type": "string"}, "message": map[string]string{"type": "string"}}, "required": []string{"label", "message"}, "additionalProperties": false}}
			continue
		case "ingredients", "steps", "energy_usage":
			properties[key] = map[string]any{"type": "array", "items": map[string]string{"type": "object"}}
			continue
		case "equipment":
			properties[key] = map[string]any{"type": "array", "items": map[string]string{"type": "integer"}}
			continue
		case "servings":
			typeName = "integer"
		case "prep_minutes", "cook_minutes":
			typeName = "number"
		}
		properties[key] = map[string]string{"type": typeName}
	}
	return map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
}

func (c *recipeChanges) tools() []ai.Tool {
	return []ai.Tool{
		{Name: "apply_recipe_changes", Description: `精确预览并暂存用户要求的局部修改。menu_changes 只填变化的菜单字段；dish_updates 只包含需改的菜，index 从0开始，changes 只填变化字段。若修改影响原有追问建议，请一并提供该菜新的 chat_suggestions（label/message 数组），仅更新建议不会算作菜谱内容修改。ingredients、steps、energy_usage 若修改须提供该道菜对应字段的完整数组（结构与当前 JSON 一致）；其他字段、其他菜会自动原样保留。单菜文档用 index=0，menu_changes 只可改 servings。不会立即写入数据库，最终回复成功后统一保存。`, Parameters: map[string]any{"type": "object", "properties": map[string]any{"menu_changes": patchFieldSchema(chatMenuFields), "dish_updates": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"index": map[string]string{"type": "integer"}, "changes": patchFieldSchema(chatDishFields)}, "required": []string{"index", "changes"}, "additionalProperties": false}}}, "required": []string{"menu_changes", "dish_updates"}, "additionalProperties": false}, Run: func(ctx context.Context, args json.RawMessage) (any, error) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return c.apply(args)
		}},
		{Name: "check_recipe", Description: "检查本轮当前候选菜谱的食材、人数、设备和时间线，返回当前 JSON 及约束问题；不修改已保存菜谱。", Parameters: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}, Run: func(ctx context.Context, _ json.RawMessage) (any, error) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return map[string]any{"recipe": c.current, "violations": calculator.Validate(c.recipe, c.request, c.preferences, c.equipment, c.pantry)}, nil
		}},
	}
}

func applyFields(target, changes map[string]any, allowed []string) error {
	for key, value := range changes {
		found := false
		for _, field := range allowed {
			if field == key {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("不允许修改字段 %s", key)
		}
		if value == nil {
			return fmt.Errorf("%s 不可为 null", key)
		}
		target[key] = value
	}
	return nil
}

func (c *recipeChanges) apply(args json.RawMessage) (any, error) {
	var input struct {
		Menu   map[string]any `json:"menu_changes"`
		Dishes []struct {
			Index   *int           `json:"index"`
			Changes map[string]any `json:"changes"`
		} `json:"dish_updates"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(args)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return nil, err
	}
	if input.Menu == nil || input.Dishes == nil {
		return nil, fmt.Errorf("menu_changes 必须为对象，dish_updates 必须为数组")
	}
	candidate := copyRecipeMap(c.current)
	allowed := chatMenuFields
	if c.kind == "dishes" {
		allowed = []string{"servings"}
	}
	if err := applyFields(candidate, input.Menu, allowed); err != nil {
		return nil, err
	}
	changed := map[int]bool{}
	for index := range c.dishes {
		changed[index] = true
	}
	for _, update := range input.Dishes {
		if update.Index == nil || *update.Index < 0 || *update.Index >= len(c.recipe.Dishes) || update.Changes == nil {
			return nil, fmt.Errorf("dish_updates 的 index 或 changes 无效")
		}
		index := *update.Index
		dish := candidate
		if c.kind == "recipes" {
			dish = candidate["dishes"].([]any)[index].(map[string]any)
		}
		before := copyRecipeMap(dish)
		if err := applyFields(dish, update.Changes, chatDishFields); err != nil {
			return nil, err
		}
		if !reflect.DeepEqual(before, dish) {
			if suggestions, ok := update.Changes["chat_suggestions"]; ok {
				raw, err := json.Marshal(suggestions)
				if err != nil {
					return nil, err
				}
				var items []model.ChatSuggestion
				if err := json.Unmarshal(raw, &items); err != nil {
					return nil, err
				}
				raw, _ = json.Marshal(cleanChatSuggestions(items))
				var normalized any
				json.Unmarshal(raw, &normalized)
				dish["chat_suggestions"] = normalized
			} else {
				dish["chat_suggestions"] = []any{}
			}
			contentBefore, contentAfter := copyRecipeMap(before), copyRecipeMap(dish)
			delete(contentBefore, "chat_suggestions")
			delete(contentAfter, "chat_suggestions")
			if !reflect.DeepEqual(contentBefore, contentAfter) {
				changed[index] = true
				delete(dish, "reuse_from")
			}
			// A different main ingredient or dish name invalidates the old photo.
			if !reflect.DeepEqual(before["name"], dish["name"]) || !reflect.DeepEqual(mainIngredients(before), mainIngredients(dish)) {
				dish["image"] = nil
			}
		}
	}
	r, err := decodeChatRecipe(candidate, c.kind)
	if err != nil {
		return nil, err
	}
	for _, update := range input.Dishes {
		dish := r.Dishes[*update.Index]
		if _, ok := update.Changes["ingredients"]; ok {
			for _, ingredient := range dish.Ingredients {
				if ingredient.Category != "main" && ingredient.Category != "supporting" && ingredient.Category != "seasoning" {
					return nil, fmt.Errorf("食材 category 必须为 main、supporting 或 seasoning")
				}
			}
		}
		if _, ok := update.Changes["steps"]; ok {
			for index, step := range dish.Steps {
				if step.Step != index+1 || strings.TrimSpace(step.Title) == "" {
					return nil, fmt.Errorf("步骤必须有标题且 step 从 1 连续编号")
				}
			}
		}
	}
	q := c.request
	q.Servings = r.Servings
	if r.Servings != c.recipe.Servings {
		r.Request.Servings = r.Servings
		request, _ := candidate["request"].(map[string]any)
		if request == nil {
			request = map[string]any{}
			candidate["request"] = request
		}
		request["servings"] = r.Servings
	}
	if len(changed) > 0 {
		for index := range changed {
			single := model.Recipe{Title: r.Title, Servings: r.Servings, Dishes: []model.Dish{r.Dishes[index]}}
			calculator.Calculate(&single, c.prices, c.pantry, c.equipment, c.preferences)
			r.Dishes[index] = single.Dishes[0]
			dish := candidate
			if c.kind == "recipes" {
				dish = candidate["dishes"].([]any)[index].(map[string]any)
			}
			calculated, _ := json.Marshal(single.Dishes[0])
			var computed map[string]any
			json.Unmarshal(calculated, &computed)
			for _, key := range strings.Fields("ingredients energy_usage cost nutrition theoretical_kwh theoretical_energy_cost") {
				dish[key] = computed[key]
			}
		}
		rollupChatRecipe(&r)
		if c.kind == "recipes" {
			b, _ := json.Marshal(r)
			var computed map[string]any
			json.Unmarshal(b, &computed)
			for _, key := range strings.Fields("total_cost purchase_cost unknown_prices nutrition total_elapsed_minutes energy_usage theoretical_kwh theoretical_energy_cost") {
				candidate[key] = computed[key]
			}
		}
	}
	violations := calculator.Validate(r, q, c.preferences, c.equipment, c.pantry)
	newViolations := []string{}
	for _, v := range violations {
		if !c.baseline[v] {
			newViolations = append(newViolations, v)
		}
	}
	if len(newViolations) > 0 {
		return nil, fmt.Errorf("修改未通过检查：%s", strings.Join(newViolations, "；"))
	}
	c.current, c.recipe, c.request, c.dishes = candidate, r, q, changed
	return map[string]any{"applied": true, "recipe": candidate, "violations": violations}, nil
}

func mainIngredients(dish map[string]any) []string {
	names := []string{}
	ingredients, _ := dish["ingredients"].([]any)
	for _, item := range ingredients {
		ingredient, _ := item.(map[string]any)
		if ingredient["category"] == "main" {
			name, _ := ingredient["name"].(string)
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// Roll up the changed dishes and the original untouched dish snapshots. Never
// reprice or rewrite an unrelated dish because a kitchen setting has changed.
func rollupChatRecipe(r *model.Recipe) {
	r.Cost, r.PurchaseCost, r.KWh, r.EnergyCost, r.Elapsed = 0, 0, 0, 0, 0
	r.UnknownPrices = 0
	r.Nutrition = model.Nutrition{}
	r.Usage = []model.Usage{}
	indices := map[uint]int{}
	for _, d := range r.Dishes {
		r.Cost += d.Cost
		r.KWh += d.KWh
		r.EnergyCost += d.EnergyCost
		r.Nutrition.Calories += d.Nutrition.Calories
		r.Nutrition.Protein += d.Nutrition.Protein
		r.Nutrition.Fat += d.Nutrition.Fat
		r.Nutrition.Carbs += d.Nutrition.Carbs
		for _, i := range d.Ingredients {
			if i.Cost == nil {
				r.UnknownPrices++
			} else if !i.IsPantry {
				r.PurchaseCost += *i.Cost
			}
		}
		for _, s := range d.Steps {
			r.Elapsed = math.Max(r.Elapsed, s.Start+s.Duration)
		}
		for _, u := range d.Usage {
			index, ok := indices[u.EquipmentID]
			if !ok {
				indices[u.EquipmentID] = len(r.Usage)
				r.Usage = append(r.Usage, u)
				continue
			}
			total := &r.Usage[index]
			minutes := total.HeatingMinutes + u.HeatingMinutes
			if total.DutyCycle != nil && u.DutyCycle != nil && minutes > 0 {
				v := (*total.DutyCycle*total.HeatingMinutes + *u.DutyCycle*u.HeatingMinutes) / minutes
				total.DutyCycle = &v
			} else {
				total.DutyCycle = nil
			}
			total.HeatingMinutes = minutes
			if total.KWh != nil && u.KWh != nil {
				v := *total.KWh + *u.KWh
				total.KWh = &v
			} else {
				total.KWh = nil
			}
			if total.EstimatedKWh != nil && u.EstimatedKWh != nil {
				v := *total.EstimatedKWh + *u.EstimatedKWh
				total.EstimatedKWh = &v
			} else {
				total.EstimatedKWh = nil
			}
		}
	}
}

func sameRecipeRevision(base, latest map[string]any, kind string) bool {
	clean := func(data map[string]any) map[string]any {
		copy := copyRecipeMap(data)
		for _, key := range strings.Fields("favorite saved rating feedback image_status token_usage chat_token_usage") {
			delete(copy, key)
		}
		if kind == "dishes" {
			delete(copy, "image")
			delete(copy, "collection_id")
		} else if dishes, ok := copy["dishes"].([]any); ok {
			for _, item := range dishes {
				dish, _ := item.(map[string]any)
				delete(dish, "image")
				delete(dish, "collection_id")
			}
		}
		return copy
	}
	return reflect.DeepEqual(clean(base), clean(latest))
}

func mergeRecipeChanges(base, next, latest map[string]any, kind string) map[string]any {
	merged := copyRecipeMap(latest)
	merge := func(from, to, target map[string]any) {
		for key, value := range to {
			if !reflect.DeepEqual(from[key], value) {
				target[key] = value
			}
		}
		for key := range from {
			if _, ok := to[key]; !ok {
				delete(target, key)
			}
		}
	}
	if kind == "recipes" {
		for index, item := range next["dishes"].([]any) {
			before, after, target := base["dishes"].([]any)[index].(map[string]any), item.(map[string]any), merged["dishes"].([]any)[index].(map[string]any)
			merge(before, after, target)
			if !reflect.DeepEqual(before["name"], after["name"]) || !reflect.DeepEqual(mainIngredients(before), mainIngredients(after)) {
				target["image"] = nil
			}
		}
		for key, value := range next {
			if key != "dishes" && !reflect.DeepEqual(base[key], value) {
				merged[key] = value
			}
		}
	} else {
		merge(base, next, merged)
		if !reflect.DeepEqual(base["name"], next["name"]) || !reflect.DeepEqual(mainIngredients(base), mainIngredients(next)) {
			merged["image"] = nil
		}
	}
	return merged
}

func changedRecipeSections(base, next map[string]any, kind string) []string {
	sections := []string{}
	add := func(section string) {
		for _, s := range sections {
			if s == section {
				return
			}
		}
		sections = append(sections, section)
	}
	diff := func(from, to map[string]any, fields string) bool {
		for _, key := range strings.Fields(fields) {
			if !reflect.DeepEqual(from[key], to[key]) {
				return true
			}
		}
		return false
	}
	if diff(base, next, "title summary tags servings total_cost purchase_cost total_elapsed_minutes") {
		add("overview")
	}
	checkDish := func(index int, from, to map[string]any) {
		if diff(from, to, strings.ReplaceAll(strings.Join(chatDishFields, " "), "chat_suggestions", "")) {
			add(fmt.Sprintf("dish-%d", index))
		}
		if diff(from, to, "ingredients") {
			add("ingredients")
		}
		if diff(from, to, "steps prep_minutes cook_minutes equipment") {
			add("timeline")
		}
		if diff(from, to, "nutrition") {
			add("nutrition")
		}
		if diff(from, to, "energy_usage theoretical_kwh theoretical_energy_cost") {
			add("energy")
		}
	}
	if kind == "recipes" {
		for i, item := range next["dishes"].([]any) {
			checkDish(i, base["dishes"].([]any)[i].(map[string]any), item.(map[string]any))
		}
	} else {
		checkDish(0, base, next)
	}
	for _, key := range []string{"nutrition", "tips", "substitutions", "sources"} {
		if diff(base, next, key) {
			add(key)
		}
	}
	if diff(base, next, "ai_commentary") {
		add("commentary")
	}
	return sections
}
