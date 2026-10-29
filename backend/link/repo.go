package link

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Link struct {
	ID            int64                  `json:"id"`
	Title         *string                `json:"title"`
	Original      string                 `json:"original"`
	Short         string                 `json:"short"`
	ShortCode     string                 `json:"shortCode"`
	CustomSlug    *string                `json:"customSlug"`
	IsActive      bool                   `json:"isActive"`
	ExpiresAt     *time.Time             `json:"expiresAt"`
	ClickCount    int                    `json:"clickCount"`
	LastClickedAt *time.Time             `json:"lastClickedAt"`
	QrConfig      map[string]interface{} `json:"qrConfig"`
	CreatedAt     time.Time              `json:"createdAt"`
	UpdatedAt     *time.Time             `json:"updatedAt"`
	HasPassword   bool                   `json:"hasPassword"`
	MaxClicks     *int                   `json:"maxClicks"`
	Tags          []string               `json:"tags"`
	OgTitle       *string                `json:"ogTitle"`
	OgDescription *string                `json:"ogDescription"`
	OgImage       *string                `json:"ogImage"`
	Timestamp     string                 `json:"timestamp"`

	passwordHash string
}

const linkColumns = `id, title, original_url, short_url, short_code, custom_slug, is_active, expires_at, click_count, last_clicked_at, qr_config, created_at, password_hash, updated_at, max_clicks, tags, og_title, og_description, og_image`

func scanLink(row pgx.Row) (*Link, error) {
	var l Link
	var sc *string
	var qr []byte
	var pw *string
	if err := row.Scan(&l.ID, &l.Title, &l.Original, &l.Short, &sc, &l.CustomSlug, &l.IsActive, &l.ExpiresAt, &l.ClickCount, &l.LastClickedAt, &qr, &l.CreatedAt, &pw, &l.UpdatedAt, &l.MaxClicks, &l.Tags, &l.OgTitle, &l.OgDescription, &l.OgImage); err != nil {
		return nil, err
	}
	if pw != nil && *pw != "" {
		l.passwordHash = *pw
		l.HasPassword = true
	}
	if sc != nil {
		l.ShortCode = *sc
	}
	if l.Tags == nil {
		l.Tags = []string{}
	}
	if len(qr) > 0 {
		_ = json.Unmarshal(qr, &l.QrConfig)
	}
	if l.QrConfig == nil {
		l.QrConfig = map[string]interface{}{}
	}
	l.Timestamp = l.CreatedAt.Local().Format("2006-01-02 15:04:05")
	return &l, nil
}

func scanLinks(rows pgx.Rows) ([]*Link, error) {
	defer rows.Close()
	var out []*Link
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Scope identifies whose links a query may see: a logged-in owner, or else the
// anonymous creator's IP hash.
type Scope struct {
	OwnerID     *int64
	CreatorHash string
}

// clause returns the WHERE fragment and its single argument (bound as $n).
func (s Scope) clause(n int) (string, interface{}) {
	if s.OwnerID != nil {
		return "owner_id = $" + strconv.Itoa(n), *s.OwnerID
	}
	// Links owned by an account are never visible through the anonymous IP scope.
	return "creator_ip_hash = $" + strconv.Itoa(n) + " AND owner_id IS NULL", s.CreatorHash
}

// CreateExtras holds the optional per-link settings beyond the core fields.
type CreateExtras struct {
	MaxClicks *int
	Tags      []string
}

func CreateLink(ctx context.Context, pool *pgxpool.Pool, title *string, originalURL, shortURL, shortCode string, customSlug *string, expiresAt *time.Time, qrConfig map[string]interface{}, ipHash string, ownerID *int64, ex CreateExtras) (*Link, error) {
	qc, _ := json.Marshal(qrConfig)
	var cs *string
	if customSlug != nil && *customSlug != "" {
		cs = customSlug
	}
	var sc *string
	if shortCode != "" {
		sc = &shortCode
	}
	if ex.Tags == nil {
		ex.Tags = []string{}
	}
	return scanLink(pool.QueryRow(ctx,
		`INSERT INTO links (title, original_url, short_url, short_code, custom_slug, expires_at, qr_config, creator_ip_hash, owner_id, max_clicks, tags)
		 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11) RETURNING `+linkColumns,
		title, originalURL, shortURL, sc, cs, expiresAt, string(qc), ipHash, ownerID, ex.MaxClicks, ex.Tags,
	))
}

func GetLinkByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*Link, error) {
	return scanLink(pool.QueryRow(ctx, `SELECT `+linkColumns+` FROM links WHERE short_code=$1 LIMIT 1`, code))
}

// GetScopedLinkByCode returns the link only if it is visible to scope.
func GetScopedLinkByCode(ctx context.Context, pool *pgxpool.Pool, code string, scope Scope) (*Link, error) {
	cond, arg := scope.clause(2)
	return scanLink(pool.QueryRow(ctx, `SELECT `+linkColumns+` FROM links WHERE short_code=$1 AND `+cond+` LIMIT 1`, code, arg))
}

// ListTags returns the owner's distinct tags with how many links use each.
func ListTags(ctx context.Context, pool *pgxpool.Pool, owner int64) ([]TagCount, error) {
	rows, err := pool.Query(ctx, `SELECT t, COUNT(*) FROM links, unnest(tags) t WHERE owner_id = $1 GROUP BY t ORDER BY 2 DESC, 1`, owner)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (TagCount, error) {
		var tc TagCount
		err := row.Scan(&tc.Tag, &tc.Count)
		return tc, err
	})
}

type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// ListLinks lists links visible to scope.
func ListLinks(ctx context.Context, pool *pgxpool.Pool, scope Scope, search, status, tag, sort string, page, limit int) ([]*Link, int, error) {
	if limit <= 0 || limit > 50 {
		limit = DefaultPageSize
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	cond, arg := scope.clause(1)
	where := "WHERE " + cond
	args := []interface{}{arg}

	switch status {
	case "active":
		where += " AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) AND (max_clicks IS NULL OR click_count < max_clicks)"
	case "inactive":
		where += " AND is_active = FALSE"
	case "expired":
		where += " AND expires_at IS NOT NULL AND expires_at <= NOW()"
	case "limit":
		where += " AND max_clicks IS NOT NULL AND click_count >= max_clicks"
	}
	if tag != "" {
		args = append(args, tag)
		where += " AND $" + strconv.Itoa(len(args)) + " = ANY(tags)"
	}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		p := "$" + strconv.Itoa(len(args))
		where += " AND (LOWER(COALESCE(title,'')) LIKE " + p + " OR LOWER(original_url) LIKE " + p + " OR LOWER(short_url) LIKE " + p + " OR LOWER(COALESCE(short_code,'')) LIKE " + p + ")"
	}

	var total int
	if err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM links "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	n := len(args)
	listSQL := "SELECT " + linkColumns + " FROM links " + where + " ORDER BY " + orderBy(sort) + " LIMIT $" + strconv.Itoa(n+1) + " OFFSET $" + strconv.Itoa(n+2)
	rows, err := pool.Query(ctx, listSQL, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	out, err := scanLinks(rows)
	if err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// orderBy maps a whitelisted sort key to SQL (never interpolate user input).
func orderBy(sort string) string {
	switch sort {
	case "clicks":
		return "click_count DESC, created_at DESC"
	case "oldest":
		return "created_at ASC"
	default:
		return "created_at DESC"
	}
}

// RecordClick logs a click; country is an ISO 3166-1 alpha-2 code or "".
func RecordClick(ctx context.Context, pool *pgxpool.Pool, linkID int64, referrer, userAgent, ipHash, country string) error {
	device, browser := ParseUserAgent(userAgent)
	var cc *string
	if country != "" {
		cc = &country
	}
	_, err := pool.Exec(ctx,
		`WITH inserted AS (INSERT INTO click_events (link_id, referrer, user_agent, ip_hash, device, browser, os, country) VALUES ($1,$2,$3,$4,$5,$6,$7,$8))
		 UPDATE links SET click_count = click_count + 1, last_clicked_at = NOW() WHERE id=$1`, linkID, referrer, userAgent, ipHash, device, browser, ParseOS(userAgent), cc)
	return err
}

func ListRedirectCandidates(ctx context.Context, pool *pgxpool.Pool, code string) ([]*Link, error) {
	rows, err := pool.Query(ctx, `SELECT `+linkColumns+` FROM links WHERE short_code=$1 ORDER BY created_at DESC`, code)
	if err != nil {
		return nil, err
	}
	return scanLinks(rows)
}
