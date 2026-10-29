package link

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	slugRe  = regexp.MustCompile(`^[a-zA-Z0-9_-]{4,32}$`)
	colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

	reservedCodes = map[string]bool{
		"admin": true, "api": true, "auth": true, "dashboard": true,
		"health": true, "ready": true, "history": true, "links": true,
		"shorten": true, "static": true, "assets": true, "www": true,
		"login": true, "register": true, "public": true,
	}
	dotsTypes    = map[string]bool{"square": true, "dots": true, "rounded": true, "classy": true, "extra-rounded": true}
	cornersTypes = map[string]bool{"square": true, "dot": true, "extra-rounded": true}
)

const DefaultPageSize = 20

func NormalizeURL(input string) (string, bool) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", false
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "file:") {
		return "", false
	}
	withProto := trimmed
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		withProto = "https://" + trimmed
	}
	parsed, err := url.Parse(withProto)
	if err != nil || parsed.Host == "" {
		return "", false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return "", false
	}
	// Block literal private / loopback / link-local IPs (DNS names are not resolved)
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return "", false
		}
	}
	return parsed.String(), true
}

func NormalizeTitle(input string) *string {
	t := strings.TrimSpace(input)
	if t == "" {
		return nil
	}
	if utf8.RuneCountInString(t) > 120 {
		t = string([]rune(t)[:120])
	}
	return &t
}

func NormalizeCustomSlug(input string) (string, string) {
	v := strings.TrimSpace(input)
	if v == "" {
		return "", ""
	}
	if !slugRe.MatchString(v) {
		return "", "Custom slug must be 4-32 chars using letters, numbers, - or _"
	}
	if IsReserved(v) {
		return "", "Custom slug is reserved"
	}
	return v, ""
}

func IsReserved(code string) bool {
	return reservedCodes[strings.ToLower(code)]
}

func NormalizeExpiry(input string, maxDays int) (*time.Time, string) {
	if strings.TrimSpace(input) == "" {
		return nil, ""
	}
	t, err := time.Parse(time.RFC3339, input)
	if err != nil {
		// datetime-local fallback (no zone; interpreted as UTC)
		t2, err2 := time.Parse("2006-01-02T15:04", input)
		if err2 != nil {
			return nil, "Invalid expiry date"
		}
		t = t2
	}
	if t.Before(time.Now()) {
		return nil, "Expiry date must be in the future"
	}
	if maxDays > 0 && t.After(time.Now().Add(time.Duration(maxDays)*24*time.Hour)) {
		return nil, fmt.Sprintf("Expiry must be within %d days", maxDays)
	}
	return &t, ""
}

func NormalizeQrConfig(input map[string]interface{}) map[string]interface{} {
	safe := make(map[string]interface{})
	if input == nil {
		return safe
	}
	for _, k := range []string{"dotsColor", "backgroundColor", "gradientColor2"} {
		if v, ok := input[k].(string); ok && colorRe.MatchString(v) {
			safe[k] = v
		}
	}
	if v, ok := input["dotsType"].(string); ok && dotsTypes[v] {
		safe["dotsType"] = v
	}
	if v, ok := input["cornersType"].(string); ok && cornersTypes[v] {
		safe["cornersType"] = v
	}
	if v, ok := input["gradient"].(bool); ok {
		safe["gradient"] = v
	}
	return safe
}

func NormalizeStatus(input string) string {
	switch input {
	case "active", "inactive", "expired", "limit":
		return input
	default:
		return "all"
	}
}

func GetBaseURL(appBaseURL, proto, host string) string {
	if appBaseURL != "" {
		return strings.TrimRight(appBaseURL, "/")
	}
	if proto == "" {
		proto = "http"
	}
	return fmt.Sprintf("%s://%s", proto, host)
}

// GenerateShortCode returns a uniformly random base62 string (rejection sampling avoids modulo bias).
func GenerateShortCode(length int) string {
	if length <= 0 {
		length = 7
	}
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	const maxByte = 256 - (256 % len(chars)) // 248
	out := make([]byte, 0, length)
	buf := make([]byte, length*2)
	for len(out) < length {
		_, _ = rand.Read(buf)
		for _, b := range buf {
			if int(b) >= maxByte {
				continue
			}
			out = append(out, chars[int(b)%len(chars)])
			if len(out) == length {
				break
			}
		}
	}
	return string(out)
}

func HashIP(appSecret, ip string) string {
	h := sha256.Sum256([]byte(appSecret + ":" + ip))
	return hex.EncodeToString(h[:])
}

func IsExpired(expiresAt *time.Time, now time.Time) bool {
	if expiresAt == nil {
		return false
	}
	return !expiresAt.After(now)
}

// MaxClicksLimit caps the configurable click limit per link.
const MaxClicksLimit = 10_000_000

// NormalizeMaxClicks validates a click limit; nil or 0 means "no limit".
func NormalizeMaxClicks(n *int) (*int, string) {
	if n == nil || *n == 0 {
		return nil, ""
	}
	if *n < 1 || *n > MaxClicksLimit {
		return nil, "Click limit must be between 1 and 10,000,000"
	}
	return n, ""
}

var tagRe = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N} _-]{0,23}$`)

// NormalizeTags lowercases, trims and de-duplicates tags (max 10, 1-24 chars each).
func NormalizeTags(in []string) ([]string, string) {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.ToLower(strings.Join(strings.Fields(t), " "))
		if t == "" || seen[t] {
			continue
		}
		if !tagRe.MatchString(t) {
			return nil, "Tags must be 1-24 letters, numbers, spaces, - or _"
		}
		seen[t] = true
		out = append(out, t)
	}
	if len(out) > 10 {
		return nil, "A link can have at most 10 tags"
	}
	return out, ""
}

// NormalizeText trims s and truncates it to max runes; "" becomes nil.
func NormalizeText(s string, max int) *string {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	if utf8.RuneCountInString(t) > max {
		t = string([]rune(t)[:max])
	}
	return &t
}

// HasClicksLeft reports whether a click limit (if any) still allows visits.
func HasClicksLeft(l *Link) bool {
	return l.MaxClicks == nil || l.ClickCount < *l.MaxClicks
}
