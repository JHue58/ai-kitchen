package calculator

import (
	"ai-kitchen/internal/model"
	"math"
	"testing"
)

func TestDishEnergyRollsUpWithoutDoubleCounting(t *testing.T) {
	r := model.Recipe{Dishes: []model.Dish{
		{Usage: []model.Usage{{EquipmentID: 1, HeatingMinutes: 10, DutyCycle: ptr(.5)}}},
		{Usage: []model.Usage{{EquipmentID: 1, HeatingMinutes: 20, DutyCycle: ptr(.8)}}},
	}, Usage: []model.Usage{{EquipmentID: 1, HeatingMinutes: 999}}}
	equipment := []model.Equipment{{ID: 1, Electric: true, Watts: ptr(2000)}}
	for iteration := 0; iteration < 2; iteration++ {
		CalculateEnergy(&r, equipment, .9)
		if math.Abs(r.KWh-1) > 1e-9 || math.Abs(r.EnergyCost-.9) > 1e-9 || len(r.Usage) != 1 || r.Usage[0].HeatingMinutes != 30 {
			t.Fatalf("menu was double-counted or stale: %+v", r)
		}
		if math.Abs(r.Dishes[0].EnergyCost-.3) > 1e-9 || math.Abs(r.Dishes[1].EnergyCost-.6) > 1e-9 {
			t.Fatalf("dish breakdown lost: %+v", r.Dishes)
		}
		if r.Usage[0].EstimatedKWh == nil || math.Abs(*r.Usage[0].EstimatedKWh-.7) > 1e-9 {
			t.Fatalf("duty-cycle estimates not aggregated: %+v", r.Usage)
		}
	}
	CalculateEnergy(&r, nil, .9)
	if r.KWh != 0 || r.Dishes[0].KWh != 0 || r.Dishes[0].Usage[0].KWh != nil || r.Usage[0].KWh != nil {
		t.Fatal("power changes retained stale dish estimates")
	}
}

func TestLegacyEnergyIsSplitOnceAndAIClassificationsSurvive(t *testing.T) {
	r := model.Recipe{Dishes: []model.Dish{
		{Name: "蒜香鸡肉", Description: "蒜香浓郁", Ingredients: []model.Ingredient{{Name: "鸡肉"}, {Name: "蒜", Category: "main"}, {Name: "盐"}}, Steps: []model.Step{{EquipmentID: 1, Duration: 10}}},
		{Name: "青菜", Description: "清脆爽口", Ingredients: []model.Ingredient{{Name: "青菜"}, {Name: "小葱"}}, Steps: []model.Step{{EquipmentID: 1, Duration: 20}}},
	}, Usage: []model.Usage{{EquipmentID: 1, HeatingMinutes: 60}}}
	CalculateEnergy(&r, []model.Equipment{{ID: 1, Electric: true, Watts: ptr(1000)}}, .9)
	if r.Dishes[0].Usage[0].HeatingMinutes != 20 || r.Dishes[1].Usage[0].HeatingMinutes != 40 || r.KWh != 1 {
		t.Fatalf("legacy menu was not proportionately split: %+v", r)
	}
	if r.Dishes[0].Commentary != "蒜香浓郁" || r.Dishes[1].Commentary != "清脆爽口" || r.Dishes[0].Ingredients[0].Category != "main" || r.Dishes[0].Ingredients[1].Category != "main" || r.Dishes[0].Ingredients[2].Category != "seasoning" || r.Dishes[1].Ingredients[1].Category != "supporting" {
		t.Fatalf("details fallback overwrote AI roles or lost descriptions: %+v", r.Dishes)
	}
}

func TestEnergyPreservesUnknownPowerAndSkipsNonElectricEquipment(t *testing.T) {
	r := model.Recipe{Dishes: []model.Dish{{Usage: []model.Usage{{EquipmentID: 1, HeatingMinutes: 10}, {EquipmentID: 2, HeatingMinutes: 10}, {EquipmentID: 3, HeatingMinutes: 10}}}}}
	CalculateEnergy(&r, []model.Equipment{{ID: 1, Electric: true, Watts: ptr(1000)}, {ID: 2, Electric: true}, {ID: 3, Electric: false}}, .9)
	if len(r.Dishes[0].Usage) != 2 || r.Dishes[0].Usage[1].KWh != nil || len(r.Usage) != 2 || math.Abs(r.EnergyCost-.15) > 1e-9 {
		t.Fatalf("unknown power was fabricated or gas cooker included: %+v", r)
	}
}
