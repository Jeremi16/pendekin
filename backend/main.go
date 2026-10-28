package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"pendekin/config"
	"pendekin/db"
	"pendekin/server"
)

func main() {
	cfg := config.Load()

	pool := db.Pool(cfg)
	if pool != nil {
		defer db.Close()
		if err := db.EnsureSchema(pool); err != nil {
			log.Printf("[ERROR] ensureSchema: %v", err)
		}
	} else {
		log.Println("[WARN] DATABASE_URL not set — running without DB (health only)")
	}

	srv := &http.Server{
		Addr:              "0.0.0.0:" + cfg.Port,
		Handler:           server.New(cfg, pool),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("Server listening on %s (baseURL=%s)", srv.Addr, cfg.AppBaseURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[WARN] shutdown: %v", err)
	}
}
