package link

import (
	"net/http"
	"reflect"
	"testing"
)

func TestNormalizeTags(t *testing.T) {
	got, err := NormalizeTags([]string{" Promo ", "promo", "Q4  2026", ""})
	if err != "" || !reflect.DeepEqual(got, []string{"promo", "q4 2026"}) {
		t.Fatalf("got %v %q", got, err)
	}
	if _, err := NormalizeTags([]string{"<script>"}); err == "" {
		t.Error("expected invalid tag error")
	}
	many := make([]string, 11)
	for i := range many {
		many[i] = string(rune('a' + i))
	}
	if _, err := NormalizeTags(many); err == "" {
		t.Error("expected too-many-tags error")
	}
}

func TestNormalizeMaxClicks(t *testing.T) {
	zero, neg, ok := 0, -1, 5
	if n, err := NormalizeMaxClicks(&zero); n != nil || err != "" {
		t.Error("0 should clear the limit")
	}
	if _, err := NormalizeMaxClicks(&neg); err == "" {
		t.Error("negative should fail")
	}
	if n, _ := NormalizeMaxClicks(&ok); n == nil || *n != 5 {
		t.Error("5 should pass")
	}
	l := &Link{ClickCount: 5, MaxClicks: &ok}
	if HasClicksLeft(l) {
		t.Error("5/5 clicks should be used up")
	}
}

func TestParseOSAndCrawler(t *testing.T) {
	if os := ParseOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"); os != "iOS" {
		t.Errorf("iPhone → %s", os)
	}
	if os := ParseOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"); os != "Windows" {
		t.Errorf("Windows → %s", os)
	}
	if !IsSocialCrawler("WhatsApp/2.23.20.0 A") || IsSocialCrawler("Mozilla/5.0 Chrome/128") {
		t.Error("crawler detection wrong")
	}
}

func TestCountryFromHeaders(t *testing.T) {
	h := http.Header{}
	h.Set("X-Vercel-IP-Country", "id")
	if c := CountryFromHeaders(h); c != "ID" {
		t.Errorf("got %q", c)
	}
	h.Set("X-Vercel-IP-Country", "XX")
	if c := CountryFromHeaders(h); c != "" {
		t.Errorf("XX should be empty, got %q", c)
	}
}
