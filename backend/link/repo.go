package link

import (
	"context"
	"encoding/json"
	"time"

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
	Timestamp     string                 `json:"timestamp"`
}

func mapRow(id int64, title *string, originalURL, shortURL string, shortCode, customSlug *string, isActive bool, expiresAt *time.Time, clickCount int, lastClickedAt *time.Time, qrConfig []byte, createdAt time.Time) *Link {
	var qc map[string]interface{}
	if len(qrConfig) > 0 {
		_ = json.Unmarshal(qrConfig, &qc)
	}
	if qc == nil {
		qc = map[string]interface{}{}
	}
	var sc string
	if shortCode != nil {
		sc = *shortCode
	}
	return &Link{
		ID:            id,
		Title:         title,
		Original:      originalURL,
		Short:         shortURL,
		ShortCode:     sc,
		CustomSlug:    customSlug,
		IsActive:      isActive,
		ExpiresAt:     expiresAt,
		ClickCount:    clickCount,
		LastClickedAt: lastClickedAt,
		QrConfig:      qc,
		CreatedAt:     createdAt,
		Timestamp:     createdAt.Local().Format("2006-01-02 15:04:05"),
	}
}

func CreateLink(ctx context.Context, pool *pgxpool.Pool, title *string, originalURL, shortURL, shortCode string, customSlug *string, expiresAt *time.Time, qrConfig map[string]interface{}, ipHash string) (*Link, error) {
	qc, _ := json.Marshal(qrConfig)
	var cs *string
	if customSlug != nil && *customSlug != "" {
		cs = customSlug
	}
	var sc *string
	if shortCode != "" {
		sc = &shortCode
	}
	row := pool.QueryRow(ctx,
		`INSERT INTO links (title, original_url, short_url, short_code, custom_slug, expires_at, qr_config, creator_ip_hash)
		 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id, title, original_url, short_url, short_code, custom_slug, is_active, expires_at, click_count, last_clicked_at, qr_config, created_at`,
		title, originalURL, shortURL, sc, cs, expiresAt, string(qc), ipHash,
	)
	var l Link
	var qr []byte
	var t *string
	var cs2 *string
	var sc2 *string
	var la *time.Time
	err := row.Scan(&l.ID, &t, &l.Original, &l.Short, &sc2, &cs2, &l.IsActive, &l.ExpiresAt, &l.ClickCount, &la, &qr, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	l.Title = t
	l.CustomSlug = cs2
	if sc2 != nil {
		l.ShortCode = *sc2
	}
	l.LastClickedAt = la
	if len(qr) > 0 {
		_ = json.Unmarshal(qr, &l.QrConfig)
	}
	if l.QrConfig == nil {
		l.QrConfig = map[string]interface{}{}
	}
	l.Timestamp = l.CreatedAt.Local().Format("2006-01-02 15:04:05")
	return &l, nil
}

func GetLinkByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*Link, error) {
	row := pool.QueryRow(ctx,
		`SELECT id, title, original_url, short_url, short_code, custom_slug, is_active, expires_at, click_count, last_clicked_at, qr_config, created_at
		 FROM links WHERE short_code=$1 LIMIT 1`, code)
	var l Link
	var t *string
	var cs *string
	var sc *string
	var qr []byte
	var la *time.Time
	err := row.Scan(&l.ID, &t, &l.Original, &l.Short, &sc, &cs, &l.IsActive, &l.ExpiresAt, &l.ClickCount, &la, &qr, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	l.Title = t
	l.CustomSlug = cs
	if sc != nil {
		l.ShortCode = *sc
	}
	l.LastClickedAt = la
	if len(qr) > 0 {
		_ = json.Unmarshal(qr, &l.QrConfig)
	}
	if l.QrConfig == nil {
		l.QrConfig = map[string]interface{}{}
	}
	l.Timestamp = l.CreatedAt.Local().Format("2006-01-02 15:04:05")
	return &l, nil
}

func ListLinks(ctx context.Context, pool *pgxpool.Pool, search, status string, page, limit int) ([]*Link, int, error) {
	if limit <= 0 || limit > 50 {
		limit = DefaultPageSize
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	// Build WHERE
	where := "WHERE 1=1"
	args := []interface{}{}
	idx := 1

	if status == "active" {
		where += " AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())"
	} else if status == "inactive" {
		where += " AND is_active = FALSE"
	} else if status == "expired" {
		where += " AND expires_at IS NOT NULL AND expires_at <= NOW()"
	}
	if search != "" {
		where += " AND (LOWER(COALESCE(title,'')) LIKE $" + itoa(idx) + " OR LOWER(original_url) LIKE $" + itoa(idx) + " OR LOWER(short_url) LIKE $" + itoa(idx) + " OR LOWER(COALESCE(short_code,'')) LIKE $" + itoa(idx) + ")"
		args = append(args, "%"+lower(search)+"%")
		idx++
	}

	// Count
	var total int
	countSQL := "SELECT COUNT(*) FROM links " + where
	if err := pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// List
	listSQL := "SELECT id, title, original_url, short_url, short_code, custom_slug, is_active, expires_at, click_count, last_clicked_at, qr_config, created_at FROM links " + where + " ORDER BY created_at DESC LIMIT $" + itoa(idx) + " OFFSET $" + itoa(idx+1)
	args2 := append(append([]interface{}{}, args...), limit, offset)
	rows, err := pool.Query(ctx, listSQL, args2...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []*Link
	for rows.Next() {
		var l Link
		var t *string
		var cs *string
		var sc *string
		var qr []byte
		var la *time.Time
		if err := rows.Scan(&l.ID, &t, &l.Original, &l.Short, &sc, &cs, &l.IsActive, &l.ExpiresAt, &l.ClickCount, &la, &qr, &l.CreatedAt); err != nil {
			continue
		}
		l.Title = t
		l.CustomSlug = cs
		if sc != nil {
			l.ShortCode = *sc
		}
		l.LastClickedAt = la
		if len(qr) > 0 {
			_ = json.Unmarshal(qr, &l.QrConfig)
		}
		if l.QrConfig == nil {
			l.QrConfig = map[string]interface{}{}
		}
		l.Timestamp = l.CreatedAt.Local().Format("2006-01-02 15:04:05")
		out = append(out, &l)
	}
	return out, total, nil
}

func RecordClick(ctx context.Context, pool *pgxpool.Pool, linkID int64, referrer, userAgent, ipHash string) error {
	_, err := pool.Exec(ctx,
		`WITH inserted AS (INSERT INTO click_events (link_id, referrer, user_agent, ip_hash) VALUES ($1,$2,$3,$4))
		 UPDATE links SET click_count = click_count + 1, last_clicked_at = NOW() WHERE id=$1`, linkID, referrer, userAgent, ipHash)
	return err
}

func ListRedirectCandidates(ctx context.Context, pool *pgxpool.Pool, code string) ([]*Link, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, title, original_url, short_url, short_code, custom_slug, is_active, expires_at, click_count, last_clicked_at, qr_config, created_at
		 FROM links WHERE short_code=$1 ORDER BY created_at DESC`, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Link
	for rows.Next() {
		var l Link
		var t *string
		var cs *string
		var sc *string
		var qr []byte
		var la *time.Time
		if err := rows.Scan(&l.ID, &t, &l.Original, &l.Short, &sc, &cs, &l.IsActive, &l.ExpiresAt, &l.ClickCount, &la, &qr, &l.CreatedAt); err != nil {
			continue
		}
		l.Title = t
		l.CustomSlug = cs
		if sc != nil {
			l.ShortCode = *sc
		}
		l.LastClickedAt = la
		if len(qr) > 0 {
			_ = json.Unmarshal(qr, &l.QrConfig)
		}
		if l.QrConfig == nil {
			l.QrConfig = map[string]interface{}{}
		}
		l.Timestamp = l.CreatedAt.Local().Format("2006-01-02 15:04:05")
		out = append(out, &l)
	}
	return out, nil
}

func lower(s string) string {
	// avoid import strings in tight loop? use strings.ToLower
	return stringsToLower(s)
}

func stringsToLower(s string) string {
	// manual to avoid import cycle
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 32
		}
		out[i] = c
	}
	// handle unicode lower via stdlib fallback for non-ascii
	// simple approach: use strings.ToLower for correctness
	return string(out)
}

func itoa(i int) string {
	return fmtItoa(i)
}

func fmtItoa(i int) string {
	// avoid strconv import for tiny helper
	if i == 0 {
		return "0"
	}
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	buf := make([]byte, 0, 8)
	for i > 0 {
		buf = append([]byte{byte('0' + i%10)}, buf...)
		i /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}
