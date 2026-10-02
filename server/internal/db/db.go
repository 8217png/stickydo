// Package db 负责数据库连接与迁移。
package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/8217png/stickydo/server/migrations"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("连接数据库: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("连接数据库: %w", err)
	}
	return pool, nil
}

// Migrate 执行 migrations/ 下所有未执行的迁移。
func Migrate(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		return err
	}
	results, err := provider.Up(ctx)
	for _, r := range results {
		log.Info("migration applied", slog.String("source", r.Source.Path), slog.Duration("duration", r.Duration))
	}
	return err
}

// OpenSQL 供需要 database/sql 的场景使用（如测试里检查迁移回滚）。
func OpenSQL(pool *pgxpool.Pool) *sql.DB { return stdlib.OpenDBFromPool(pool) }
