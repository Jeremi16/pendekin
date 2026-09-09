package link

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	slugRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{4,32}$`)
	reservedCodes = map[string]bool{
		"admin": true, "api": true, "auth": true, "dashboard": true,
		"health": true, "ready": true, "history": true, "links": true,
		"shorten": true, "static": true, "assets": true, "www": true,
		"login": true, "register": true, "public": true,
	}
)

const DefaultPageSize = 20

func NormalizeURL(input string) (string, bool) {
	if input == "" {
		return "", false
	}
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", false
	}
	// Block dangerous schemes
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "file:") {
		return "", false
	}
	withProto := trimmed
	if !strings.HasPrefix(strings.ToLower(trimmed), "http://") && !strings.HasPrefix(strings.ToLower(trimmed), "https://") {
		withProto = "https://" + trimmed
	}
	parsed, err := url.Parse(withProto)
	if err != nil || parsed.Host == "" {
		return "", false
	}
	// Block private / loopback hosts by string check (deep DNS check is at handler)
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host == "::1" {
		return "", false
	}
	if strings.HasPrefix(host, "10.") || strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "172.") {
		// allow 172.16-31 private; be permissive for now — full IP check done via DNS lookup if needed
	}
	return parsed.String(), true
}

func NormalizeTitle(input string) *string {
	t := strings.TrimSpace(input)
	if t == "" {
		return nil
	}
	if len(t) > 120 {
		t = t[:120]
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
	if reservedCodes[strings.ToLower(v)] {
		return "", "Custom slug is reserved"
	}
	return v, ""
}

func NormalizeExpiry(input string, maxDays int) (*time.Time, string) {
	if strings.TrimSpace(input) == "" {
		return nil, ""
	}
	t, err := time.Parse(time.RFC3339, input)
	if err != nil {
		// try datetime-local format 2006-01-02T15:04
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
	if input == nil {
		return map[string]interface{}{}
	}
	safe := make(map[string]interface{})
	if v, ok := input["dotsColor"].(string); ok && v != "" {
		safe["dotsColor"] = v
	}
	if v, ok := input["backgroundColor"].(string); ok && v != "" {
		safe["backgroundColor"] = v
	}
	if v, ok := input["dotsType"].(string); ok && v != "" {
		safe["dotsType"] = v
	}
	if v, ok := input["cornersType"].(string); ok && v != "" {
		safe["cornersType"] = v
	}
	if v, ok := input["gradient"].(bool); ok {
		safe["gradient"] = v
	}
	if v, ok := input["gradientColor2"].(string); ok && v != "" {
		safe["gradientColor2"] = v
	}
	return safe
}

func NormalizeStatus(input string) string {
	switch input {
	case "active", "inactive", "expired":
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

func GenerateShortCode(length int) string {
	if length <= 0 {
		length = 7
	}
	// base64url approx length*3/4 bytes
	need := (length*6 + 7) / 8 // slightly over
	if need < 6 {
		need = 6
	}
	b := make([]byte, need)
	_, _ = rand.Read(b)
	// Generate alphanumeric base62
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	out := make([]byte, length)
	for i := 0; i < length; i++ {
		out[i] = chars[int(b[i%len(b)])%len(chars)]
	}
	return string(out)
}

func HashIP(appSecret, ip string) string {
	if appSecret == "" {
		appSecret = "pendekin"
	}
	h := sha256.Sum256([]byte(appSecret + ":" + ip))
	return hex.EncodeToString(h[:])
}

func IsExpired(expiresAt *time.Time, now time.Time) bool {
	if expiresAt == nil {
		return false
	}
	return !expiresAt.After(now)
}

func ExtractShortCode(shortURL string) string {
	if shortURL == "" {
		return ""
	}
	u, err := url.Parse(shortURL)
	if err == nil && u.Path != "" {
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) > 0 {
			return parts[len(parts)-1]
		}
	}
	// fallback
	s := strings.Split(shortURL, "?")[0]
	s = strings.Split(s, "#")[0]
	s = strings.TrimRight(s, "/")
	parts := strings.Split(s, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return ""
}
