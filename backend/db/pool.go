package db

import (
	"context"
	"log"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	"pendekin/config"
)

var (
	pool     *pgxpool.Pool
	poolOnce sync.Once
	poolErr  error
)

func Pool(cfg *config.Config) *pgxpool.Pool {
	poolOnce.Do(func() {
		if cfg.DatabaseURL == "" {
			log.Println("[WARN] DATABASE_URL not set — DB disabled")
			return
		}
		// pgx parses sslmode from URL. For Neon we keep require, for local disable.
		// No extra ssl struct needed; pgx handles it via query param.
		c, err := pgxpool.ParseConfig(cfg.DatabaseURL)
		if err != nil {
			poolErr = err
			log.Printf("[ERROR] invalid DATABASE_URL: %v", err)
			return
		}
		c.MaxConns = 8
		c.MinConns = 1
		// Lower-case check for neon host to warn if sslmode missing
		if strings.Contains(strings.ToLower(cfg.DatabaseURL), "neon.tech") && !strings.Contains(cfg.DatabaseURL, "sslmode=") {
			log.Println("[WARN] Neon DATABASE_URL should include sslmode=require")
		}
		p, err := pgxpool.NewWithConfig(context.Background(), c)
		if err != nil {
			poolErr = err
			log.Printf("[ERROR] failed to create pool: %v", err)
			return
		}
		if err := p.Ping(context.Background()); err != nil {
			log.Printf("[WARN] DB ping failed: %v", err)
		}
		pool = p
	})
	if poolErr != nil {
		return nil
	}
	return pool
}

func Close() {
	if pool != nil {
		pool.Close()
	}
}
