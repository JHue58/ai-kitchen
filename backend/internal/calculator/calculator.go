package calculator

import (
	"ai-kitchen/internal/model"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

var foods = map[string]model.Nutrition{
	"鸡蛋":  {Calories: 143, Protein: 12.6, Fat: 9.5, Carbs: .7},
	"鸡胸肉": {Calories: 120, Protein: 22.5, Fat: 2.6, Carbs: 0},
	"西兰花": {Calories: 34, Protein: 2.8, Fat: .4, Carbs: 6.6},
	"番茄":  {Calories: 18, Protein: .9, Fat: .2, Carbs: 3.9},
	"米饭":  {Calories: 130, Protein: 2.7, Fat: .3, Carbs: 28.2},
	"土豆":  {Calories: 77, Protein: 2, Fat: .1, Carbs: 17},
	"豆腐":  {Calories: 76, Protein: 8, Fat: 4.8, Carbs: 1.9},
}

func add(a *model.Nutrition, b model.Nutrition, f float64) {
	a.Calories += b.Calories * f
	a.Protein += b.Protein * f
	a.Fat += b.Fat * f
	a.Carbs += b.Carbs * f
}
func Convert(q float64, from, to string) (float64, bool) {
	if from == to {
		return q, true
	}
	scales := map[string]float64{"g": 1, "kg": 1000, "ml": 1, "L": 1000}
	mass := func(s string) bool { return s == "g" || s == "kg" }
	vol := func(s string) bool { return s == "ml" || s == "L" }
	if mass(from) && mass(to) || vol(from) && vol(to) {
		return q * scales[from] / scales[to], true
	}
	return 0, false
}
func Parse(b []byte) (model.Recipe, error) {
	var r model.Recipe
	if e := json.Unmarshal(b, &r); e != nil {
		return r, fmt.Errorf("模型返回的 JSON 无效: %w", e)
	}
	if r.Title == "" || r.Servings < 1 || r.Servings > 10 || len(r.Dishes) == 0 || len(r.Dishes) > 12 {
		return r, fmt.Errorf("菜单结构不完整")
	}
	valid := func(v float64) bool { return v >= 0 && !math.IsInf(v, 0) && !math.IsNaN(v) }
	for _, d := range r.Dishes {
		if d.Name == "" || len(d.Ingredients) == 0 || len(d.Steps) == 0 || !valid(d.PrepMinutes) || !valid(d.CookMinutes) {
			return r, fmt.Errorf("菜品缺少名称、食材或步骤")
		}
		for _, i := range d.Ingredients {
			if i.Name == "" || i.Unit == "" || !valid(i.Quantity) || i.Quantity == 0 {
				return r, fmt.Errorf("食材数量或单位无效")
			}
			for _, v := range []*float64{i.Weight, i.Price} {
				if v != nil && !valid(*v) {
					return r, fmt.Errorf("食材估算数值无效")
				}
			}
			if i.Nutrition != nil {
				n := i.Nutrition
				if !valid(n.Calories) || !valid(n.Protein) || !valid(n.Fat) || !valid(n.Carbs) {
					return r, fmt.Errorf("营养数值无效")
				}
			}
		}
		for _, s := range d.Steps {
			if s.Description == "" || !valid(s.Duration) || !valid(s.Start) {
				return r, fmt.Errorf("步骤或时间线无效")
			}
		}
	}
	for _, u := range r.Usage {
		if !valid(u.HeatingMinutes) || u.DutyCycle != nil && (*u.DutyCycle < 0 || *u.DutyCycle > 1) {
			return r, fmt.Errorf("设备加热时间无效")
		}
	}
	return r, nil
}
func Calculate(r *model.Recipe, prices []model.Price, pantry []model.Pantry, equipment []model.Equipment, p model.Preferences) {
	if len(r.Tags) == 0 {
		r.Tags = []string{"未知"}
	}
	r.Cost = 0
	r.PurchaseCost = 0
	r.UnknownPrices = 0
	r.Nutrition = model.Nutrition{}
	r.KWh = 0
	r.EnergyCost = 0
	r.Elapsed = 0
	for di := range r.Dishes {
		d := &r.Dishes[di]
		if len(d.Tags) == 0 {
			d.Tags = []string{"未知"}
		}
		d.Cost = 0
		d.Nutrition = model.Nutrition{}
		for ii := range d.Ingredients {
			i := &d.Ingredients[ii]
			i.Cost = nil
			i.Totals = model.Nutrition{}
			i.CostSource = "unknown"
			i.NutritionSource = "unknown"
			i.IsPantry = false
			for _, item := range pantry {
				if item.Name == i.Name {
					i.IsPantry = true
				}
			}
			var known *model.Price
			for pi := range prices {
				if prices[pi].Name == i.Name {
					known = &prices[pi]
					break
				}
			}
			if known != nil && known.Price != nil {
				if q, ok := Convert(i.Quantity, i.Unit, known.Unit); ok {
					v := q * *known.Price
					i.Cost = &v
					i.CostSource = "personal"
				}
			}
			weight, hasWeight := Convert(i.Quantity, i.Unit, "g")
			if !hasWeight && i.Weight != nil {
				weight = *i.Weight
				hasWeight = true
			}
			if i.Cost == nil && i.Price != nil && hasWeight {
				v := weight / 1000 * *i.Price
				i.Cost = &v
				i.CostSource = "estimated"
			}
			n := i.Nutrition
			if n != nil {
				i.NutritionSource = "ai_estimated"
			}
			if v, ok := foods[i.Name]; ok {
				n = &v
				i.NutritionSource = "reference_estimated"
			}
			if known != nil && known.Nutrition != nil {
				n = known.Nutrition
				i.NutritionSource = "personal_estimated"
			}
			if n != nil && hasWeight {
				add(&i.Totals, *n, weight/100)
				add(&d.Nutrition, i.Totals, 1)
			} else {
				i.NutritionSource = "unknown"
			}
			if i.Cost != nil {
				d.Cost += *i.Cost
				if !i.IsPantry {
					r.PurchaseCost += *i.Cost
				}
			} else {
				r.UnknownPrices++
			}
		}
		r.Cost += d.Cost
		add(&r.Nutrition, d.Nutrition, 1)
		for _, s := range d.Steps {
			r.Elapsed = math.Max(r.Elapsed, s.Start+s.Duration)
		}
	}
	for ui := range r.Usage {
		u := &r.Usage[ui]
		u.KWh = nil
		u.EstimatedKWh = nil
		for _, e := range equipment {
			if e.ID == u.EquipmentID && e.Electric && e.Watts != nil {
				v := *e.Watts * u.HeatingMinutes / 60000
				u.KWh = &v
				r.KWh += v
				if u.DutyCycle != nil {
					a := v * *u.DutyCycle
					u.EstimatedKWh = &a
				}
			}
		}
	}
	r.EnergyCost = r.KWh * p.ElectricityPrice
}
func Validate(r model.Recipe, q model.Request, p model.Preferences, eq []model.Equipment, pantry []model.Pantry) []string {
	w := []string{}
	if q.DishCount > 0 && len(r.Dishes) != q.DishCount || q.Target == "dish" && len(r.Dishes) != 1 {
		w = append(w, "菜品数量不符合要求")
	}
	if r.Servings != q.Servings {
		w = append(w, "人数不符合要求")
	}
	if q.Budget != nil && r.Cost > *q.Budget {
		w = append(w, "估算成本超过预算")
	}
	if q.Budget != nil && r.UnknownPrices > 0 {
		w = append(w, "存在未知价格，无法确认预算")
	}
	if q.Minutes != nil && r.Elapsed > *q.Minutes {
		w = append(w, "总耗时超过限制")
	}
	allowed := map[uint]bool{}
	for _, e := range eq {
		allowed[e.ID] = true
	}
	ingredients := map[string]bool{}
	for _, n := range q.Ingredients {
		ingredients[n] = true
	}
	for _, i := range pantry {
		if i.Category == "调料" {
			ingredients[i.Name] = true
		}
	}
	for _, d := range r.Dishes {
		for _, i := range d.Ingredients {
			for _, a := range append(append([]string{}, p.Allergies...), p.Avoid...) {
				if a != "" && strings.Contains(i.Name, a) {
					w = append(w, "含过敏或忌口食材："+i.Name)
				}
			}
			if q.Mode == "strict" && !ingredients[i.Name] {
				w = append(w, "纯限定模式不允许："+i.Name)
			}
		}
		for _, id := range d.Equipment {
			if !allowed[id] {
				w = append(w, "使用了未授权炊具")
			}
		}
		for _, s := range d.Steps {
			if s.EquipmentID != 0 && !allowed[s.EquipmentID] {
				w = append(w, "步骤使用了未授权炊具")
			}
		}
	}
	for _, u := range r.Usage {
		if !allowed[u.EquipmentID] {
			w = append(w, "耗电记录包含未授权炊具")
		}
	}
	type interval struct{ start, end float64 }
	slots := map[uint][]interval{}
	for _, d := range r.Dishes {
		for _, s := range d.Steps {
			if s.EquipmentID == 0 {
				continue
			}
			for _, a := range slots[s.EquipmentID] {
				if s.Start < a.end && s.Start+s.Duration > a.start {
					w = append(w, "同一炊具时间线冲突")
				}
			}
			slots[s.EquipmentID] = append(slots[s.EquipmentID], interval{s.Start, s.Start + s.Duration})
		}
	}
	return w
}
