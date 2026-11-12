package search

import (
	"ai-kitchen/internal/model"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Fixed public endpoint: neither the agent nor a search result controls the fetch host.
func Images(ctx context.Context, query string) ([]model.DishImage, error) {
	if len([]rune(query)) > 128 || strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("图片搜索词无效")
	}
	q := url.Values{"action": {"query"}, "format": {"json"}, "generator": {"search"}, "gsrsearch": {query + " filetype:bitmap"}, "gsrnamespace": {"6"}, "gsrlimit": {"5"}, "prop": {"imageinfo"}, "iiprop": {"url|size|mime|extmetadata"}, "iiurlwidth": {"960"}, "iiextmetadatafilter": {"Artist|LicenseShortName"}}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://commons.wikimedia.org/w/api.php?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AIKitchen/1.0 (recipe image reference search)")
	client := http.Client{Timeout: 12 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("图片搜索暂不可用: %d", res.StatusCode)
	}
	return decodeImages(io.LimitReader(res.Body, 2<<20))
}
func decodeImages(body io.Reader) ([]model.DishImage, error) {
	var data struct {
		Query struct {
			Pages map[string]struct {
				Title     string
				Imageinfo []struct {
					URL            string
					ThumbURL       string
					DescriptionURL string
					Width          int
					Height         int
					ThumbWidth     int
					ThumbHeight    int
					Mime           string
					Extmetadata    map[string]struct{ Value string }
				}
			}
		}
	}
	if err := json.NewDecoder(body).Decode(&data); err != nil {
		return nil, err
	}
	out := []model.DishImage{}
	tags := regexp.MustCompile(`<[^>]*>`)
	for _, p := range data.Query.Pages {
		for _, i := range p.Imageinfo {
			if i.Width < 640 || i.Height < 480 || !strings.HasPrefix(i.Mime, "image/") || i.Mime == "image/svg+xml" {
				continue
			}
			target := i.ThumbURL
			if target == "" {
				target = i.URL
			}
			u, err := url.Parse(target)
			if err != nil || u.Scheme != "https" || u.Hostname() != "upload.wikimedia.org" {
				continue
			}
			source, err := url.Parse(i.DescriptionURL)
			if err != nil || source.Scheme != "https" || source.Hostname() != "commons.wikimedia.org" {
				continue
			}
			clean := func(s string) string { return strings.TrimSpace(html.UnescapeString(tags.ReplaceAllString(s, ""))) }
			license := clean(i.Extmetadata["LicenseShortName"].Value)
			credit := clean(i.Extmetadata["Artist"].Value)
			if license == "" || credit == "" {
				continue
			}
			if i.ThumbURL != "" && (i.ThumbWidth < 480 || i.ThumbHeight < 320) {
				continue
			}
			out = append(out, model.DishImage{URL: target, SourceURL: i.DescriptionURL, Title: p.Title, Credit: credit, License: license})
		}
	}
	return out, nil
}
