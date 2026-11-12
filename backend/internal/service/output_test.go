package service

import (
	"strings"
	"testing"
)

const validGeneratedRecipe = `{"title":"鸡蛋晚餐","tags":["家常菜"],"summary":"晚餐","servings":2,"dishes":[{"image":null,"tags":["家常菜"],"name":"鸡蛋","description":"鸡蛋","ingredients":[{"name":"鸡蛋","quantity":2,"unit":"个","estimated_edible_weight_g":100,"estimated_price_per_kg":20,"nutrition_per_100g":null}],"equipment":[],"prep_minutes":0,"cook_minutes":10,"steps":[{"step":1,"title":"制作","description":"充分加热","duration_minutes":10,"start_minute":0,"equipment_id":0,"temperature_c":null,"power_level":"","safety_note":""}]}],"energy_usage":[],"ai_commentary":"家常菜","tips":[],"substitutions":[]}`

func TestGeneratedRecipeContract(t *testing.T) {
	if _, err := parseGeneratedRecipe([]byte(validGeneratedRecipe)); err != nil {
		t.Fatal(err)
	}
	for _, change := range [][2]string{
		{`"image":null,`, ""},
		{`"image":null`, `"image":"https://example.com/a.jpg"`},
		{`"image":null`, `"image":{"url":"https://example.com/a.jpg"}`},
		{`"quantity":2`, `"quantity":"2"`},
		{`"quantity":2`, `"quantity":null`},
		{`"start_minute":0`, `"start_minute":null`},
		{`"tips":[]`, `"tips":null`},
		{`"tags":["家常菜"]`, `"tags":[null]`},
		{`"servings":2`, `"servings":2.5`},
		{`"step":1`, `"step":0`},
		{`"title":"制作"`, `"title":""`},
	} {
		if _, err := parseGeneratedRecipe([]byte(strings.ReplaceAll(validGeneratedRecipe, change[0], change[1]))); err == nil {
			t.Errorf("accepted invalid output: %v", change)
		}
	}
}

func TestPromptExampleMatchesContract(t *testing.T) {
	start := strings.Index(Prompt, `{"title"`)
	end := strings.Index(Prompt[start:], "\n")
	if _, err := parseGeneratedRecipe([]byte(Prompt[start : start+end])); err != nil {
		t.Fatalf("prompt example violates contract: %v", err)
	}
}
