package db

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EnsureSchema creates/extends pendekin's own tables. It never drops anything,
// so it is safe on a database shared with other apps.
func EnsureSchema(pool *pgxpool.Pool) error {
	if pool == nil {
		return nil
	}
	ctx := context.Background()

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS links (
			id BIGSERIAL PRIMARY KEY,
			original_url TEXT NOT NULL,
			short_url TEXT NOT NULL,
			short_code TEXT UNIQUE,
			custom_slug TEXT,
			title TEXT,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			expires_at TIMESTAMPTZ,
			click_count INTEGER NOT NULL DEFAULT 0,
			last_clicked_at TIMESTAMPTZ,
			qr_config JSONB NOT NULL DEFAULT '{}'::jsonb,
			creator_ip_hash TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS click_events (
			id BIGSERIAL PRIMARY KEY,
			link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
			clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			referrer TEXT,
			user_agent TEXT,
			ip_hash TEXT
		)`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS title TEXT`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS custom_slug TEXT`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS qr_config JSONB NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS creator_ip_hash TEXT`,
		`CREATE INDEX IF NOT EXISTS links_created_at_desc_idx ON links(created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS links_short_code_unique_idx ON links(short_code) WHERE short_code IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS links_custom_slug_idx ON links(custom_slug) WHERE custom_slug IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS links_creator_created_idx ON links(creator_ip_hash, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS click_events_link_id_idx ON click_events(link_id, clicked_at DESC)`,
		// Accounts (optional login). Named to avoid clashing with legacy users/sessions tables.
		`CREATE TABLE IF NOT EXISTS accounts (
			id BIGSERIAL PRIMARY KEY,
			email TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_idx ON accounts(LOWER(email))`,
		`CREATE TABLE IF NOT EXISTS account_sessions (
			token_hash TEXT PRIMARY KEY,
			account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions(account_id)`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL`,
		`CREATE INDEX IF NOT EXISTS links_owner_created_idx ON links(owner_id, created_at DESC) WHERE owner_id IS NOT NULL`,
		// Dashboard features
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS password_hash TEXT`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`,
		`ALTER TABLE click_events ADD COLUMN IF NOT EXISTS device TEXT`,
		`ALTER TABLE click_events ADD COLUMN IF NOT EXISTS browser TEXT`,
		// Nodryx SSO: accounts can be provisioned by login without a local password.
		`ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL`,
		// Linked external identities. (provider, subject) is the stable key —
		// subjects never change, emails might.
		`CREATE TABLE IF NOT EXISTS auth_identities (
			provider TEXT NOT NULL,
			subject TEXT NOT NULL,
			account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			email TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (provider, subject)
		)`,
		`CREATE INDEX IF NOT EXISTS auth_identities_account_idx ON auth_identities(account_id)`,
		// Display name, synced from the Nodryx profile on each login.
		`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`,
		// Server-side OAuth flow storage: state + PKCE verifier, single-use, short TTL.
		`CREATE TABLE IF NOT EXISTS oauth_flows (
			state TEXT PRIMARY KEY,
			code_verifier TEXT NOT NULL,
			redirect_to TEXT NOT NULL DEFAULT '',
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		// Nodryx token chain per session. Refresh tokens are needed verbatim for
		// refresh/logout, so they are stored encrypted (AES-256-GCM), not hashed.
		`CREATE TABLE IF NOT EXISTS nodryx_tokens (
			session_token_hash TEXT PRIMARY KEY,
			account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			refresh_token_enc BYTEA NOT NULL,
			access_token_enc BYTEA NOT NULL,
			access_expires_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS nodryx_tokens_account_idx ON nodryx_tokens(account_id)`,
	}

	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			return err
		}
	}
	log.Println("[schema] ready")
	return nil
}
