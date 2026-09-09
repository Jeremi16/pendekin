package link

import (
	"testing"
	"time"
)

func TestNormalizeURL(t *testing.T) {
	cases := []struct {
		in    string
		want  bool
	}{
		{"https://example.com/a", true},
		{"example.com/a", true}, // scheme auto-added
		{"javascript:alert(1)", false},
		{"data:text/html,hi", false},
		{"file:///etc/passwd", false},
		{"http://localhost:3000/x", false},
		{"http://127.0.0.1/x", false},
		{"", false},
	}
	for _, c := range cases {
		_, ok := NormalizeURL(c.in)
		if ok != c.want {
			t.Errorf("NormalizeURL(%q) = %v, want %v", c.in, ok, c.want)
		}
	}
}

func TestNormalizeCustomSlug(t *testing.T) {
	if _, errStr := NormalizeCustomSlug("api"); errStr == "" {
		t.Error("reserved slug 'api' should be rejected")
	}
	if _, errStr := NormalizeCustomSlug("ab"); errStr == "" {
		t.Error("short slug should be rejected")
	}
	if s, errStr := NormalizeCustomSlug("promo2026"); errStr != "" || s != "promo2026" {
		t.Errorf("valid slug rejected: %q %q", s, errStr)
	}
}

func TestNormalizeExpiry(t *testing.T) {
	past := time.Now().Add(-time.Hour).Format(time.RFC3339)
	if _, errStr := NormalizeExpiry(past, 90); errStr == "" {
		t.Error("past expiry should be rejected")
	}
	far := time.Now().Add(100 * 24 * time.Hour).Format(time.RFC3339)
	if _, errStr := NormalizeExpiry(far, 90); errStr == "" {
		t.Error("expiry beyond max TTL should be rejected")
	}
	ok := time.Now().Add(24 * time.Hour).Format(time.RFC3339)
	if _, errStr := NormalizeExpiry(ok, 90); errStr != "" {
		t.Errorf("valid expiry rejected: %s", errStr)
	}
}

func TestIsExpired(t *testing.T) {
	if IsExpired(nil, time.Now()) {
		t.Error("nil expiry should not be expired")
	}
	past := time.Now().Add(-time.Minute)
	if !IsExpired(&past, time.Now()) {
		t.Error("past expiry should be expired")
	}
}
