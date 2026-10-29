package link

import (
	"net/http"
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

// ParseOS returns a coarse operating system name for a user agent.
func ParseOS(ua string) string {
	u := strings.ToLower(ua)
	switch {
	case u == "":
		return "Unknown"
	case strings.Contains(u, "iphone") || strings.Contains(u, "ipad") || strings.Contains(u, "ipod"):
		return "iOS"
	case strings.Contains(u, "android"):
		return "Android"
	case strings.Contains(u, "windows"):
		return "Windows"
	case strings.Contains(u, "cros"):
		return "ChromeOS"
	case strings.Contains(u, "mac os x") || strings.Contains(u, "macintosh"):
		return "macOS"
	case strings.Contains(u, "linux"):
		return "Linux"
	default:
		return "Other"
	}
}

// socialCrawlers are link-preview fetchers that read OG tags. Several (WhatsApp,
// Telegram) don't say "bot", so they're matched by name.
var socialCrawlers = []string{
	"facebookexternalhit", "facebot", "twitterbot", "whatsapp", "telegrambot", "slackbot",
	"discordbot", "linkedinbot", "skypeuripreview", "pinterest", "redditbot", "embedly",
	"line-poker", "kakaotalk", "googlebot", "bingbot", "applebot", "mastodon",
}

// IsSocialCrawler reports whether ua is a link-preview / social crawler.
func IsSocialCrawler(ua string) bool {
	u := strings.ToLower(ua)
	for _, c := range socialCrawlers {
		if strings.Contains(u, c) {
			return true
		}
	}
	return false
}

// CountryFromHeaders reads the edge-provided visitor country (Vercel or
// Cloudflare). Only call it when the proxy is trusted.
func CountryFromHeaders(h http.Header) string {
	for _, k := range []string{"X-Vercel-IP-Country", "CF-IPCountry"} {
		v := strings.ToUpper(strings.TrimSpace(h.Get(k)))
		if len(v) == 2 && v[0] >= 'A' && v[0] <= 'Z' && v[1] >= 'A' && v[1] <= 'Z' && v != "XX" {
			return v
		}
	}
	return ""
}
