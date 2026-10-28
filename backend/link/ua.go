package link

import (
	"net/url"
	"strings"
)

// ParseUserAgent returns a coarse (device, browser) pair. Order matters: many
// UAs contain several tokens (e.g. Edge includes "Chrome" and "Safari").
func ParseUserAgent(ua string) (device, browser string) {
	u := strings.ToLower(ua)
	switch {
	case u == "":
		device = "Unknown"
	case strings.Contains(u, "bot") || strings.Contains(u, "crawler") || strings.Contains(u, "spider") || strings.Contains(u, "curl") || strings.Contains(u, "wget"):
		device = "Bot"
	case strings.Contains(u, "ipad") || strings.Contains(u, "tablet"):
		device = "Tablet"
	case strings.Contains(u, "mobi") || strings.Contains(u, "iphone") || strings.Contains(u, "android"):
		device = "Mobile"
	default:
		device = "Desktop"
	}
	switch {
	case u == "":
		browser = "Unknown"
	case strings.Contains(u, "edg/"):
		browser = "Edge"
	case strings.Contains(u, "opr/") || strings.Contains(u, "opera"):
		browser = "Opera"
	case strings.Contains(u, "samsungbrowser"):
		browser = "Samsung Internet"
	case strings.Contains(u, "firefox") || strings.Contains(u, "fxios"):
		browser = "Firefox"
	case strings.Contains(u, "chrome") || strings.Contains(u, "crios"):
		browser = "Chrome"
	case strings.Contains(u, "safari"):
		browser = "Safari"
	default:
		browser = "Other"
	}
	return device, browser
}

// ReferrerHost reduces a referrer URL to its host ("Direct" when empty).
func ReferrerHost(ref string) string {
	if ref == "" {
		return "Direct"
	}
	u, err := url.Parse(ref)
	if err != nil || u.Host == "" {
		return "Other"
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}
