// Package jobs 是服务端的定时任务。
package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/8217png/stickydo/server/internal/repo"
)

// PurgeResult 一次清理删掉的记录数
type PurgeResult struct {
	Notes, Boards, Detached int64
}

// PurgeTrash 彻底删除软删除超过 retention 的便利贴和看板（回收站保留期，docs/architecture.md §5.7）。
func PurgeTrash(ctx context.Context, pool *pgxpool.Pool, retention time.Duration, now time.Time) (PurgeResult, error) {
	var r PurgeResult
	before := now.Add(-retention)
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := repo.New(tx)
		var err error
		if r.Detached, err = q.DetachNotesFromPurgedBoards(ctx, before); err != nil {
			return err
		}
		if r.Boards, err = q.PurgeDeletedBoards(ctx, before); err != nil {
			return err
		}
		r.Notes, err = q.PurgeDeletedNotes(ctx, before)
		return err
	})
	return r, err
}

// RunTrashPurge 启动后先清理一次，之后每 every 清理一次，直到 ctx 结束。
func RunTrashPurge(ctx context.Context, pool *pgxpool.Pool, retention, every time.Duration, log *slog.Logger) {
	run := func() {
		r, err := PurgeTrash(ctx, pool, retention, time.Now())
		if err != nil {
			if ctx.Err() == nil {
				log.Error("回收站清理失败", slog.Any("err", err))
			}
			return
		}
		if r.Notes+r.Boards > 0 {
			log.Info("回收站清理", slog.Int64("notes", r.Notes), slog.Int64("boards", r.Boards), slog.Int64("detached_notes", r.Detached))
		}
	}
	run()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
