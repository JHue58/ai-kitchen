package calculator

import (
	"ai-kitchen/internal/model"
	"math"
	"testing"
)

func ptr(v float64) *float64 { return &v }
func TestConversions(t *testing.T) {
	for _, v := range []struct {
		q        float64
		from, to string
		want     float64
		ok       bool
	}{{300, "g", "kg", .3, true}, {2, "L", "ml", 2000, true}, {2, "个", "kg", 0, false}, {200, "ml", "g", 0, false}} {
		got, ok := Convert(v.q, v.from, v.to)
		if got != v.want || ok != v.ok {
			t.Fatalf("%+v got %v %v", v, got, ok)
		}
	}
}
func TestTotalsAndUnknownPower(t *testing.T) {
	r := model.Recipe{Servings: 2, Dishes: []model.Dish{{Ingredients: []model.Ingredient{{Name: "鸡蛋", Quantity: 2, Unit: "个", Weight: ptr(100), Price: ptr(20)}, {Name: "未知食材", Quantity: 10, Unit: "ml"}}, Steps: []model.Step{{Start: 0, Duration: 10}}}}, Usage: []model.Usage{{EquipmentID: 1, HeatingMinutes: 60}, {EquipmentID: 2, HeatingMinutes: 60}}}
	Calculate(&r, []model.Price{{Name: "鸡蛋", Price: ptr(.8), Unit: "个"}}, nil, []model.Equipment{{ID: 1, Electric: true, Watts: ptr(2000)}, {ID: 2, Electric: true}}, model.Preferences{ElectricityPrice: .9})
	if math.Abs(r.Cost-1.6) > .0001 || r.UnknownPrices != 1 || r.Nutrition.Calories != 143 || r.KWh != 2 || r.EnergyCost != 1.8 || r.Usage[1].KWh != nil {
		t.Fatalf("unexpected totals %+v", r)
	}
	Calculate(&r, nil, nil, nil, model.Preferences{ElectricityPrice: .9})
	if r.KWh != 0 || r.Usage[0].KWh != nil {
		t.Fatal("stale totals")
	}
}
func TestConstraints(t *testing.T) {
	r := model.Recipe{Servings: 3, Cost: 50, Elapsed: 80, Dishes: []model.Dish{{Ingredients: []model.Ingredient{{Name: "花生油"}}, Equipment: []uint{9}, Steps: []model.Step{{EquipmentID: 9}}}}}
	q := model.Request{Servings: 2, Mode: "strict", Ingredients: []string{"鸡蛋"}, Budget: ptr(20), Minutes: ptr(30)}
	if len(Validate(r, q, model.Preferences{Allergies: []string{"花生"}}, nil, nil)) < 6 {
		t.Fatal("constraints not enforced")
	}
}
func TestSchema(t *testing.T) {
	for _, raw := range []string{`{}`, `not json`, `{"title":"x","servings":2,"dishes":[{"name":"x","ingredients":[{"name":"x","quantity":-1,"unit":"g"}],"steps":[{"description":"x"}]}]}`} {
		if _, e := Parse([]byte(raw)); e == nil {
			t.Fatal("invalid recipe accepted")
		}
	}
}
