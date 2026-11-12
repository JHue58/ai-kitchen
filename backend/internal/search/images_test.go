package search

import (
	"strings"
	"testing"
)

func TestDecodeImages(t *testing.T) {
	valid := `{"query":{"pages":{"1":{"title":"File:Tomato eggs.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/food.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Food.jpg","width":1200,"height":800,"mime":"image/jpeg","extmetadata":{"Artist":{"value":"<b>Photographer</b>"},"LicenseShortName":{"value":"CC BY-SA 4.0"}}}]}}}}`
	images, err := decodeImages(strings.NewReader(valid))
	if err != nil || len(images) != 1 || images[0].Credit != "Photographer" {
		t.Fatalf("decode: %+v %v", images, err)
	}
	for _, bad := range []string{strings.Replace(valid, `"width":1200`, `"width":200`, 1), strings.Replace(valid, "upload.wikimedia.org", "example.com", 1), strings.Replace(valid, "CC BY-SA 4.0", "", 1)} {
		images, err := decodeImages(strings.NewReader(bad))
		if err != nil || len(images) != 0 {
			t.Fatalf("must reject invalid image: %+v %v", images, err)
		}
	}
}
