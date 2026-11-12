package search

import (
	"ai-kitchen/internal/model"
	"golang.org/x/net/html"
	"net/url"
	"path"
	"regexp"
	"strings"
)

// DiscoverImages uses only URLs present in search results or fetched page content.
// It does not invent URLs or infer attribution/licensing from the page title.
func DiscoverImages(source model.Source) []model.DishImage {
	out := []model.DishImage{}
	seen := map[string]bool{}
	base, err := url.Parse(source.URL)
	if err != nil || !SafeURL(source.URL) {
		return out
	}
	add := func(image model.DishImage) {
		u, err := url.Parse(strings.TrimSpace(image.URL))
		if err != nil || image.URL == "" {
			return
		}
		image.URL = base.ResolveReference(u).String()
		if !SafeURL(image.URL) || seen[image.URL] || len(out) >= 12 {
			return
		}
		if image.SourceURL == "" || !SafeURL(image.SourceURL) {
			image.SourceURL = source.URL
		}
		if image.Title == "" {
			image.Title = source.Title
		}
		seen[image.URL] = true
		out = append(out, image)
	}
	for _, image := range source.Images {
		add(image)
	}
	switch strings.ToLower(path.Ext(base.Path)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		add(model.DishImage{URL: source.URL})
	}
	text := source.Content + "\n" + source.Snippet + "\n" + source.Summary
	markdown := regexp.MustCompile(`!\[([^\]]*)\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)`)
	for _, match := range markdown.FindAllStringSubmatch(text, 12) {
		add(model.DishImage{URL: match[2], Title: match[1]})
	}
	tokenizer := html.NewTokenizer(strings.NewReader(text))
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			break
		}
		if kind != html.StartTagToken && kind != html.SelfClosingTagToken {
			continue
		}
		token := tokenizer.Token()
		attrs := map[string]string{}
		for _, attr := range token.Attr {
			attrs[attr.Key] = attr.Val
		}
		if token.Data == "img" {
			target := attrs["src"]
			if target == "" {
				target = attrs["data-src"]
			}
			add(model.DishImage{URL: target, Title: attrs["alt"]})
		}
		if token.Data == "meta" && (attrs["property"] == "og:image" || attrs["name"] == "twitter:image") {
			add(model.DishImage{URL: attrs["content"]})
		}
	}
	return out
}
