package link

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

var safeBrowsingClient = &http.Client{Timeout: 3 * time.Second}

// CheckSafeBrowsing asks Google Safe Browsing (v4 Lookup API) whether target is
// a known malware/phishing URL. With no key configured it always reports safe.
func CheckSafeBrowsing(ctx context.Context, apiKey, target string) (unsafe bool, err error) {
	if apiKey == "" {
		return false, nil
	}
	body, _ := json.Marshal(map[string]any{
		"client": map[string]string{"clientId": "pendekin", "clientVersion": "1.0"},
		"threatInfo": map[string]any{
			"threatTypes":      []string{"MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"},
			"platformTypes":    []string{"ANY_PLATFORM"},
			"threatEntryTypes": []string{"URL"},
			"threatEntries":    []map[string]string{{"url": target}},
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://safebrowsing.googleapis.com/v4/threatMatches:find?key="+apiKey, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := safeBrowsingClient.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return false, fmt.Errorf("safe browsing: status %d", res.StatusCode)
	}
	var out struct {
		Matches []json.RawMessage `json:"matches"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return false, err
	}
	return len(out.Matches) > 0, nil
}
