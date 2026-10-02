package httpserver_test

// 回收站清理（internal/jobs）：软删除超过保留期的彻底删除，看板里还在用的便利贴移到收件箱。

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/8217png/stickydo/server/internal/jobs"
)

func TestPurgeTrash(t *testing.T) {
	e := newEnv(t)
	s := e.register(uniqueEmail(), "correct horse")
	now := e.clock.Now()
	oldNote := uuid.Must(uuid.NewV7()).String()
	recentNote := uuid.Must(uuid.NewV7()).String()
	liveNote := uuid.Must(uuid.NewV7()).String()
	board := uuid.Must(uuid.NewV7()).String()

	// 看板 + 其中一张还在用的便利贴；两张便利贴先建后删
	r := e.do("POST", "/sync/push", s.access, map[string]any{
		"boards": []any{boardChange(board, 0, now, "旧看板")},
		"notes":  []any{noteIn(liveNote, now, "还在用", board), noteIn(oldNote, now, "很久以前删的", nil), noteIn(recentNote, now, "最近删的", nil)},
	})
	expectStatus(t, r, 200)
	e.push(s.access, change{id: oldNote, base: 0, at: now.Add(time.Minute), deleted: true}, change{id: recentNote, at: now.Add(time.Minute), deleted: true})
	expectStatus(t, e.do("POST", "/sync/push", s.access, map[string]any{"notes": []any{}, "boards": []any{boardChange(board, 0, now.Add(time.Minute), "")}}), 200)

	// 把“很久以前”的删除时间改到 40 天前
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "UPDATE notes SET deleted_at = now() - interval '40 days' WHERE id = $1", oldNote); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE boards SET deleted_at = now() - interval '40 days' WHERE id = $1", board); err != nil {
		t.Fatal(err)
	}

	res, err := jobs.PurgeTrash(ctx, pool, 30*24*time.Hour, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if res.Notes < 1 || res.Boards < 1 || res.Detached < 1 {
		t.Fatalf("purge result: %+v", res)
	}
	count := func(q string, id string) int {
		var n int
		if err := pool.QueryRow(ctx, q, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if count("SELECT count(*) FROM notes WHERE id = $1", oldNote) != 0 {
		t.Fatal("old deleted note should be purged")
	}
	if count("SELECT count(*) FROM notes WHERE id = $1", recentNote) != 1 {
		t.Fatal("recently deleted note should stay")
	}
	if count("SELECT count(*) FROM boards WHERE id = $1", board) != 0 {
		t.Fatal("old deleted board should be purged")
	}
	if count("SELECT count(*) FROM notes WHERE id = $1 AND deleted_at IS NULL AND board_id IS NULL", liveNote) != 1 {
		t.Fatal("live note in purged board should move to inbox, not be deleted")
	}
}
