-- 同步（docs/architecture.md §5）

-- name: LockSyncSeq :one
-- 推送时锁住用户的版本序列：同一用户的推送串行执行，版本号按提交顺序递增，
-- 拉取游标不会跳过尚未提交的版本
SELECT last_version FROM user_sync_seq WHERE user_id = $1 FOR UPDATE;

-- name: SetSyncSeq :exec
UPDATE user_sync_seq SET last_version = $2 WHERE user_id = $1;

-- name: GetSyncSeq :one
SELECT last_version FROM user_sync_seq WHERE user_id = $1;

-- name: GetNoteForUpdate :one
SELECT * FROM notes WHERE id = $1 FOR UPDATE;

-- name: InsertNote :one
INSERT INTO notes (
    id, user_id, content, color, pinned, archived,
    pos_x, pos_y, width, height, z_index,
    created_at, updated_at, deleted_at, version, board_id
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11,
    now(), $12, $13, $14, $15
)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: UpdateNote :one
UPDATE notes SET
    content = $2, color = $3, pinned = $4, archived = $5,
    pos_x = $6, pos_y = $7, width = $8, height = $9, z_index = $10,
    updated_at = $11, deleted_at = $12, version = $13, board_id = $14
WHERE id = $1
RETURNING *;

-- name: MarkNoteDeleted :one
UPDATE notes SET updated_at = $2, deleted_at = $2, version = $3
WHERE id = $1
RETURNING *;

-- name: PullNotes :many
SELECT * FROM notes
WHERE user_id = $1 AND version > sqlc.arg(since) AND version <= sqlc.arg(upto)
ORDER BY version
LIMIT sqlc.arg(max_rows);

-- name: BoardOwnedBy :one
-- 便利贴引用的看板是否属于该用户（已删除的看板也算，便利贴照常保存）
SELECT EXISTS (SELECT 1 FROM boards WHERE id = $1 AND user_id = $2);

-- name: GetBoardForUpdate :one
SELECT * FROM boards WHERE id = $1 FOR UPDATE;

-- name: InsertBoard :one
INSERT INTO boards (id, user_id, name, color, sort_order, created_at, updated_at, version)
VALUES ($1, $2, $3, $4, $5, now(), $6, $7)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: UpdateBoard :one
UPDATE boards SET
    name = $2, color = $3, sort_order = $4, updated_at = $5, deleted_at = NULL, version = $6
WHERE id = $1
RETURNING *;

-- name: MarkBoardDeleted :one
UPDATE boards SET updated_at = $2, deleted_at = $2, version = $3
WHERE id = $1
RETURNING *;

-- name: PullBoards :many
-- 看板很少，一次取完 (since, upto] 区间内的全部变化
SELECT * FROM boards
WHERE user_id = $1 AND version > sqlc.arg(since) AND version <= sqlc.arg(upto)
ORDER BY version;
