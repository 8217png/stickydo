// Sticky-Do API 服务。配置见 internal/config（环境变量前缀 STICKYDO_）。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/8217png/stickydo/server/internal/auth"
	"github.com/8217png/stickydo/server/internal/config"
	"github.com/8217png/stickydo/server/internal/db"
	"github.com/8217png/stickydo/server/internal/jobs"
	"github.com/8217png/stickydo/server/internal/realtime"
	httpserver "github.com/8217png/stickydo/server/internal/http"
	"github.com/8217png/stickydo/server/internal/service"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server exited", slog.Any("err", err))
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if cfg.AutoMigrate {
		if err := db.Migrate(ctx, pool, log); err != nil {
			return err
		}
	}

	authSvc := service.NewAuth(pool, auth.NewTokens(cfg.JWTSecret, cfg.AccessTTL), cfg.RefreshTTL, log)
	syncSvc := service.NewSync(pool)
	hub := realtime.NewHub(realtime.Options{
		Authenticate:   authSvc.Authenticate,
		Version:        syncSvc.Version,
		DeviceActive:   authSvc.DeviceActive,
		OriginPatterns: realtime.HostPatterns(cfg.CORSOrigins),
		Log:            log,
	})
	authSvc.Sessions = hub
	handler, err := httpserver.New(httpserver.Deps{
		Pool: pool, Auth: authSvc, Sync: syncSvc, Hub: hub, Log: log, CORSOrigins: cfg.CORSOrigins, TrustProxy: cfg.TrustProxy,
	})
	if err != nil {
		return err
	}

	if cfg.TrashRetention > 0 {
		go jobs.RunTrashPurge(ctx, pool, cfg.TrashRetention, 6*time.Hour, log)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", slog.String("addr", cfg.Addr))
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
	}
	return nil
}

func newLogger(cfg config.Config) *slog.Logger {
	var level slog.Level
	_ = level.UnmarshalText([]byte(strings.ToUpper(cfg.LogLevel)))
	opts := &slog.HandlerOptions{Level: level}
	if cfg.LogFormat == "json" {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}
