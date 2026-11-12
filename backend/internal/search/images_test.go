package search

import (
	"ai-kitchen/internal/model"
	"testing"
)

func TestDiscoverImages(t *testing.T) {
	source := model.Source{URL: "https://example.com/recipes/eggs", Title: "鸡蛋", Content: `![成品](/food.jpg)
 <img src="/food.jpg"><img src="https://127.0.0.1/private.png">
 <meta property="og:image" content="https://cdn.example.com/eggs.webp">
 <img data-src="../other.png" alt="另一张">`, Images: []model.DishImage{{URL: "https://cdn.example.com/structured.jpg", Credit: "作者", License: "CC BY"}}}
	images := DiscoverImages(source)
	if len(images) != 4 {
		t.Fatalf("unexpected images: %+v", images)
	}
	if images[0].Credit != "作者" || images[1].URL != "https://example.com/food.jpg" || images[1].SourceURL != source.URL || images[1].License != "" {
		t.Fatalf("bad metadata: %+v", images)
	}
	if images[3].URL != "https://example.com/other.png" {
		t.Fatal(images[3])
	}
	if len(DiscoverImages(model.Source{URL: "https://example.com/photo.jpg?size=large"})) != 1 {
		t.Fatal("missing direct image")
	}
}
