package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImageTimeoutConfiguration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil || c.Images.TimeoutSeconds != 60 {
		t.Fatalf("default timeout: %+v %v", c.Images, err)
	}
	if err := os.WriteFile(path, []byte("images:\n  timeout_seconds: 15\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c, err = Load(path)
	if err != nil || c.Images.TimeoutSeconds != 15 {
		t.Fatalf("YAML timeout: %+v %v", c.Images, err)
	}
	t.Setenv("KITCHEN_IMAGES_TIMEOUT_SECONDS", "7")
	c, err = Load(path)
	if err != nil || c.Images.TimeoutSeconds != 7 {
		t.Fatalf("override timeout: %+v %v", c.Images, err)
	}
	t.Setenv("KITCHEN_IMAGES_TIMEOUT_SECONDS", "0")
	if _, err := Load(path); err == nil {
		t.Fatal("accepted invalid timeout")
	}
}
