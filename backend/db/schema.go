package db

import (
	"context"
	"log"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func EnsureSchema(pool *pgxpool.Pool) error {
	if pool == nil {
		return nil
	}
	ctx := context.Background()

	// Drop legacy shortio tables if they exist (migration from pendekin-v2)
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
		);`,
		`CREATE TABLE IF NOT EXISTS click_events (
			id BIGSERIAL PRIMARY KEY,
			link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
			clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			referrer TEXT,
			user_agent TEXT,
			ip_hash TEXT
		);`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS title TEXT;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS custom_slug TEXT;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS qr_config JSONB NOT NULL DEFAULT '{}'::jsonb;`,
		`ALTER TABLE links ADD COLUMN IF NOT EXISTS creator_ip_hash TEXT;`,
		// Legacy cleanup: make user_id nullable/drop FK if exists, then drop column if desired
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='links' AND column_name='user_id') THEN
				BEGIN
					ALTER TABLE links DROP CONSTRAINT IF EXISTS links_user_id_fkey;
				EXCEPTION WHEN OTHERS THEN NULL;
				END;
				BEGIN
					ALTER TABLE links ALTER COLUMN user_id DROP NOT NULL;
				EXCEPTION WHEN OTHERS THEN NULL;
				END;
			END IF;
		END $$;`,
		// Drop shortio legacy
		`DROP TABLE IF EXISTS shortio_link_daily_stats CASCADE;`,
		`DROP TABLE IF EXISTS shortio_link_breakdowns CASCADE;`,
		`DROP TABLE IF EXISTS sessions CASCADE;`,
		`DROP TABLE IF EXISTS users CASCADE;`,
		`DROP TABLE IF EXISTS audit_logs CASCADE;`,
		`DROP INDEX IF EXISTS links_shortio_provider_link_id_unique_idx;`,
		`DROP INDEX IF EXISTS links_provider_short_code_idx;`,
		`DROP INDEX IF EXISTS links_user_id_idx;`,
		`DO $$ BEGIN
			-- Drop provider columns if they exist
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='links' AND column_name='provider') THEN
				ALTER TABLE links DROP COLUMN provider;
			END IF;
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='links' AND column_name='requested_provider') THEN
				ALTER TABLE links DROP COLUMN requested_provider;
			END IF;
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='links' AND column_name='provider_link_id') THEN
				ALTER TABLE links DROP COLUMN provider_link_id;
			END IF;
			FOR col IN SELECT unnest(ARRAY['last_provider_sync_at','provider_sync_status','provider_sync_error','last_provider_total_clicks','last_provider_human_clicks','last_provider_period_key','last_provider_period_human_clicks']) LOOP
				BEGIN
					EXECUTE format('ALTER TABLE links DROP COLUMN IF EXISTS %I', col);
				EXCEPTION WHEN OTHERS THEN NULL;
				END;
			END LOOP;
		END $$;`,
		`CREATE INDEX IF NOT EXISTS links_created_at_desc_idx ON links(created_at DESC);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS links_short_code_unique_idx ON links(short_code) WHERE short_code IS NOT NULL;`,
		`CREATE INDEX IF NOT EXISTS links_custom_slug_idx ON links(custom_slug) WHERE custom_slug IS NOT NULL;`,
		`CREATE INDEX IF NOT EXISTS click_events_link_id_idx ON click_events(link_id, clicked_at DESC);`,
	}

	for _, s := range stmts {
		trimmed := strings.TrimSpace(s)
		if trimmed == "" {
			continue
		}
		if _, err := pool.Exec(ctx, trimmed); err != nil {
			// Log but continue if IF NOT EXISTS handles idempotency
			lower := strings.ToLower(trimmed)
			if strings.Contains(lower, "drop") || strings.Contains(lower, "alter") {
				log.Printf("[schema] non-fatal: %v | stmt: %.80s", err, trimmed)
				continue
			}
			return err
		}
	}
	log.Println("[schema] ready")
	return nil
}
