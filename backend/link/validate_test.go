package link

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeURL(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"https://example.com/a", true},
		{"example.com/a", true}, // scheme auto-added
		{"javascript:alert(1)", false},
		{"data:text/html,hi", false},
		{"file:///etc/passwd", false},
		{"http://localhost:3000/x", false},
		{"http://127.0.0.1/x", false},
		{"http://10.0.0.5/x", false},
		{"http://192.168.1.1/", false},
		{"http://172.16.0.1/", false},
		{"http://169.254.169.254/latest", false},
		{"http://[::1]/", false},
		{"http://[fd00::1]/", false},
		{"http://172.217.0.1/", true}, // public 172.x
		{"http://app.localhost/", false},
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

func TestGenerateShortCode(t *testing.T) {
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	seen := map[string]bool{}
	sameEnds := 0
	for i := 0; i < 2000; i++ {
		c := GenerateShortCode(7)
		if len(c) != 7 {
			t.Fatalf("len %d", len(c))
		}
		for _, r := range c {
			if !strings.ContainsRune(chars, r) {
				t.Fatalf("bad char %q", r)
			}
		}
		if c[0] == c[6] {
			sameEnds++
		}
		seen[c] = true
	}
	if len(seen) < 1999 {
		t.Errorf("too many collisions: %d unique", len(seen))
	}
	// ~32 expected by chance; the old byte-reuse bug made this 2000
	if sameEnds > 100 {
		t.Errorf("first/last char correlated: %d", sameEnds)
	}
}

func TestNormalizeTitleUTF8(t *testing.T) {
	in := strings.Repeat("é", 200)
	got := NormalizeTitle(in)
	if got == nil || len([]rune(*got)) != 120 || !strings.HasPrefix(in, *got) {
		t.Error("title truncation split or miscounted runes")
	}
}

func TestNormalizeQrConfig(t *testing.T) {
	got := NormalizeQrConfig(map[string]interface{}{
		"dotsColor": "#abcdef", "backgroundColor": "red;<script>", "dotsType": "rounded", "cornersType": "evil",
	})
	if got["dotsColor"] != "#abcdef" || got["dotsType"] != "rounded" {
		t.Errorf("valid values dropped: %v", got)
	}
	if _, ok := got["backgroundColor"]; ok {
		t.Error("invalid color kept")
	}
	if _, ok := got["cornersType"]; ok {
		t.Error("invalid corners type kept")
	}
}
