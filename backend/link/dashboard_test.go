package link

import "testing"

func TestParseUserAgent(t *testing.T) {
	cases := []struct{ ua, device, browser string }{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0", "Desktop", "Edge"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Mobile", "Safari"},
		{"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36", "Mobile", "Chrome"},
		{"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1", "Tablet", "Safari"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Desktop", "Firefox"},
		{"Googlebot/2.1 (+http://www.google.com/bot.html)", "Bot", "Other"},
		{"curl/8.4.0", "Bot", "Other"},
		{"", "Unknown", "Unknown"},
	}
	for _, c := range cases {
		d, b := ParseUserAgent(c.ua)
		if d != c.device || b != c.browser {
			t.Errorf("ParseUserAgent(%.40q) = %s/%s, want %s/%s", c.ua, d, b, c.device, c.browser)
		}
	}
}

func TestReferrerHost(t *testing.T) {
	for in, want := range map[string]string{
		"":                                "Direct",
		"https://www.Google.com/search?q": "google.com",
		"https://t.co/abc":                "t.co",
		"not a url":                       "Other",
	} {
		if got := ReferrerHost(in); got != want {
			t.Errorf("ReferrerHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateBulk(t *testing.T) {
	many := make([]int64, 501)
	cases := []struct {
		req bulkReq
		ok  bool
	}{
		{bulkReq{IDs: []int64{1}, Action: "delete"}, true},
		{bulkReq{IDs: []int64{1, 2}, Action: "activate"}, true},
		{bulkReq{IDs: []int64{1}, Action: "deactivate"}, true},
		{bulkReq{IDs: nil, Action: "delete"}, false},
		{bulkReq{IDs: many, Action: "delete"}, false},
		{bulkReq{IDs: []int64{1}, Action: "drop table"}, false},
	}
	for _, c := range cases {
		if got := validateBulk(c.req) == ""; got != c.ok {
			t.Errorf("validateBulk(%d ids, %q) ok=%v, want %v", len(c.req.IDs), c.req.Action, got, c.ok)
		}
	}
}

func TestOrderByWhitelist(t *testing.T) {
	if orderBy("clicks") != "click_count DESC, created_at DESC" || orderBy("oldest") != "created_at ASC" {
		t.Error("known sort keys mapped wrong")
	}
	if got := orderBy("id; DROP TABLE links"); got != "created_at DESC" {
		t.Errorf("unknown sort not defaulted: %q", got)
	}
}
