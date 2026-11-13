package calculator

import (
	"ai-kitchen/internal/model"
	"strings"
)

// NormalizeRecipeDetails upgrades legacy snapshots without changing quantities,
// prices or their cooking timeline. Newly generated recipes use the strict AI
// contract instead; these fallbacks only fill missing historical fields.
func NormalizeRecipeDetails(r *model.Recipe) {
	for di := range r.Dishes {
		d := &r.Dishes[di]
		if strings.TrimSpace(d.Commentary) == "" {
			d.Commentary = d.Description
			if len(r.Dishes) == 1 && strings.TrimSpace(r.Commentary) != "" {
				d.Commentary = r.Commentary
			}
			if strings.TrimSpace(d.Commentary) == "" {
				d.Commentary = d.Name + "，按食材用量和步骤制作，调味可依个人口味调整。"
			}
		}
		for ii := range d.Ingredients {
			i := &d.Ingredients[ii]
			if i.Category == "" {
				i.Category = legacyIngredientCategory(i.Name)
			}
		}
	}
	// A nil array means the old snapshot did not record energy per dish. Split
	// each menu equipment record once, so sharing a cooker never duplicates its
	// heating minutes or the menu's electricity estimate.
	legacyUsage := make([][]model.Usage, len(r.Dishes))
	for _, usage := range r.Usage {
		remaining := usage.HeatingMinutes
		weights := make([]float64, len(r.Dishes))
		weight := 0.0
		for di, d := range r.Dishes {
			if d.Usage != nil {
				for _, u := range d.Usage {
					if u.EquipmentID == usage.EquipmentID {
						remaining -= u.HeatingMinutes
					}
				}
				continue
			}
			for _, step := range d.Steps {
				if step.EquipmentID == usage.EquipmentID {
					weights[di] += step.Duration
				}
			}
			if weights[di] == 0 {
				for _, id := range d.Equipment {
					if id == usage.EquipmentID {
						weights[di] = d.CookMinutes
					}
				}
			}
			weight += weights[di]
		}
		if remaining <= 0 {
			continue
		}
		if weight == 0 {
			for di, d := range r.Dishes {
				if d.Usage == nil {
					weights[di] = 1
					weight++
				}
			}
		}
		for di, share := range weights {
			if share > 0 {
				u := usage
				u.HeatingMinutes = remaining * share / weight
				// Append after all menu entries are distributed, keeping nil as the
				// missing-field marker throughout the pass.
				legacyUsage[di] = append(legacyUsage[di], u)
			}
		}
	}
	for di := range r.Dishes {
		d := &r.Dishes[di]
		if d.Usage != nil {
			continue
		}
		d.Usage = legacyUsage[di]
		if d.Usage == nil && len(r.Usage) == 0 {
			// Independent old dishes have no menu record to split. Their device
			// timeline is the best available heating-duration estimate.
			for _, step := range d.Steps {
				if step.EquipmentID != 0 && step.Duration > 0 {
					d.Usage = append(d.Usage, model.Usage{EquipmentID: step.EquipmentID, HeatingMinutes: step.Duration})
				}
			}
		}
		if d.Usage == nil {
			d.Usage = []model.Usage{}
		}
	}
}

// CalculateEnergy treats dish usage as authoritative and builds the menu total
// from it. The AI's menu-wide record is only used to upgrade legacy snapshots.
func CalculateEnergy(r *model.Recipe, equipment []model.Equipment, price float64) {
	NormalizeRecipeDetails(r)
	r.Usage = []model.Usage{}
	r.KWh, r.EnergyCost = 0, 0
	indices := map[uint]int{}
	for di := range r.Dishes {
		d := &r.Dishes[di]
		d.KWh, d.EnergyCost = 0, 0
		filtered := make([]model.Usage, 0, len(d.Usage))
		for _, u := range d.Usage {
			nonElectric := false
			for _, e := range equipment {
				if e.ID == u.EquipmentID && !e.Electric {
					nonElectric = true
					break
				}
			}
			if !nonElectric {
				filtered = append(filtered, u)
			}
		}
		d.Usage = filtered
		for ui := range d.Usage {
			u := &d.Usage[ui]
			u.KWh, u.EstimatedKWh = nil, nil
			for _, e := range equipment {
				if e.ID == u.EquipmentID && e.Electric && e.Watts != nil {
					v := *e.Watts * u.HeatingMinutes / 60000
					u.KWh = &v
					d.KWh += v
					if u.DutyCycle != nil {
						estimate := v * *u.DutyCycle
						u.EstimatedKWh = &estimate
					}
					break
				}
			}
			index, exists := indices[u.EquipmentID]
			if !exists {
				indices[u.EquipmentID] = len(r.Usage)
				r.Usage = append(r.Usage, *u)
				continue
			}
			total := &r.Usage[index]
			minutes := total.HeatingMinutes + u.HeatingMinutes
			if total.DutyCycle != nil && u.DutyCycle != nil && minutes > 0 {
				duty := (*total.DutyCycle*total.HeatingMinutes + *u.DutyCycle*u.HeatingMinutes) / minutes
				total.DutyCycle = &duty
			} else {
				total.DutyCycle = nil
			}
			total.HeatingMinutes = minutes
			if total.KWh != nil && u.KWh != nil {
				value := *total.KWh + *u.KWh
				total.KWh = &value
			} else {
				total.KWh = nil
			}
			if total.EstimatedKWh != nil && u.EstimatedKWh != nil {
				value := *total.EstimatedKWh + *u.EstimatedKWh
				total.EstimatedKWh = &value
			} else {
				total.EstimatedKWh = nil
			}
		}
		d.EnergyCost = d.KWh * price
		r.KWh += d.KWh
		r.EnergyCost += d.EnergyCost
	}
}

func legacyIngredientCategory(name string) string {
	for _, seasoning := range []string{"油", "食用油", "植物油", "花生油", "橄榄油", "香油", "芝麻油", "盐", "食盐", "糖", "白糖", "冰糖", "生抽", "老抽", "酱油", "蚝油", "料酒", "醋", "陈醋", "米醋", "白醋", "胡椒粉", "黑胡椒", "白胡椒", "五香粉", "孜然粉", "辣椒粉", "鸡精", "味精", "豆瓣酱", "甜面酱", "番茄酱", "淀粉", "玉米淀粉"} {
		if name == seasoning {
			return "seasoning"
		}
	}
	for _, supporting := range []string{"葱", "小葱", "大葱", "葱花", "姜", "生姜", "蒜", "大蒜", "蒜末", "蒜瓣", "香菜", "干辣椒", "八角", "桂皮", "香叶", "花椒", "清水", "水", "高汤"} {
		if name == supporting {
			return "supporting"
		}
	}
	return "main"
}
