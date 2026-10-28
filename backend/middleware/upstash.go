package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// UpstashStore implements CounterStore against Upstash Redis's REST API — no
// persistent TCP connection, so it works on serverless platforms. Each Take
// runs as one atomic EVAL (INCR + PEXPIRE + PTTL) so fixed windows stay exact
// even with many concurrent instances sharing one Redis.
type UpstashStore struct {
	url   string
	token string
	http  *http.Client
}

// NewUpstashStore returns a CounterStore backed by Upstash Redis REST
// (https://xxx.upstash.io + the REST token from the Upstash console).
func NewUpstashStore(url, token string) *UpstashStore {
	return &UpstashStore{
		url:   strings.TrimRight(url, "/"),
		token: token,
		http:  &http.Client{Timeout: 3 * time.Second},
	}
}

// incrScript atomically increments the window counter, initializes the window
// on first increment, and returns the count plus remaining window TTL (ms).
const incrScript = `local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {v, redis.call('PTTL', KEYS[1])}`

// getScript reads the counter and TTL without touching them (nil when absent).
const getScript = `local v = redis.call('GET', KEYS[1])
if v == false then return {nil, 0} end
return {v, redis.call('PTTL', KEYS[1])}`

type upstashResult struct {
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

func (u *UpstashStore) eval(script string, key string, argv ...string) (json.RawMessage, error) {
	args := []any{"EVAL", script, "1", key}
	for _, a := range argv {
		args = append(args, a)
	}
	body, _ := json.Marshal(args)
	req, err := http.NewRequest(http.MethodPost, u.url, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+u.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := u.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out upstashResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("upstash decode: %w", err)
	}
	if out.Error != "" {
		return nil, fmt.Errorf("upstash error: %s", out.Error)
	}
	return out.Result, nil
}

// parsePair reads the [value, ttlMs] array returned by the scripts. The value
// is nil when the key does not exist.
func parsePair(raw json.RawMessage) (count int, ttlMs int64, exists bool, err error) {
	var pair []json.RawMessage
	if err := json.Unmarshal(raw, &pair); err != nil {
		return 0, 0, false, fmt.Errorf("upstash pair: %w", err)
	}
	if len(pair) != 2 {
		return 0, 0, false, fmt.Errorf("upstash pair: want 2 elements, got %d", len(pair))
	}
	if string(pair[0]) == "null" {
		return 0, int64(parseJSONInt(pair[1])), false, nil
	}
	n, err := strconv.Atoi(string(pair[0]))
	if err != nil {
		return 0, 0, false, fmt.Errorf("upstash count: %w", err)
	}
	return n, parseJSONInt(pair[1]), true, nil
}

func parseJSONInt(raw json.RawMessage) int64 {
	n, _ := strconv.ParseInt(string(raw), 10, 64)
	return n
}

func (u *UpstashStore) Take(key string, window time.Duration, now time.Time) (int, time.Time, error) {
	raw, err := u.eval(incrScript, key, strconv.FormatInt(window.Milliseconds(), 10))
	if err != nil {
		return 0, time.Time{}, err
	}
	count, ttlMs, _, err := parsePair(raw)
	if err != nil {
		return 0, time.Time{}, err
	}
	resetAt := now.Add(time.Duration(ttlMs) * time.Millisecond)
	if ttlMs <= 0 {
		resetAt = now.Add(window)
	}
	return count, resetAt, nil
}

func (u *UpstashStore) Peek(key string, window time.Duration, now time.Time) (int, time.Time, error) {
	raw, err := u.eval(getScript, key)
	if err != nil {
		return 0, time.Time{}, err
	}
	count, ttlMs, exists, err := parsePair(raw)
	if err != nil {
		return 0, time.Time{}, err
	}
	if !exists {
		return 0, now.Add(window), nil
	}
	resetAt := now.Add(time.Duration(ttlMs) * time.Millisecond)
	if ttlMs <= 0 {
		resetAt = now.Add(window)
	}
	return count, resetAt, nil
}
