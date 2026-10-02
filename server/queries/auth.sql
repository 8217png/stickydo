-- 认证相关查询（sqlc 生成到 internal/repo）

-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: InitUserSyncSeq :exec
INSERT INTO user_sync_seq (user_id) VALUES ($1);

-- name: GetUserByEmail :one
SELECT * FROM users WHERE lower(email) = lower(sqlc.arg(email));

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2, password_changed_at = now(), updated_at = now()
WHERE id = $1;

-- name: CreateDevice :one
INSERT INTO devices (id, user_id, name, platform, refresh_token_hash, refresh_expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetDeviceByRefreshHashForUpdate :one
SELECT * FROM devices WHERE refresh_token_hash = $1 FOR UPDATE;

-- name: GetDeviceByPrevRefreshHash :one
SELECT * FROM devices WHERE prev_refresh_token_hash = $1;

-- name: RotateDeviceRefreshToken :execrows
UPDATE devices
SET prev_refresh_token_hash = refresh_token_hash,
    refresh_token_hash      = sqlc.arg(new_hash),
    refresh_expires_at      = sqlc.arg(expires_at),
    last_seen_at            = now()
WHERE id = sqlc.arg(id)
  AND refresh_token_hash = sqlc.arg(old_hash)
  AND revoked_at IS NULL;

-- name: GetActiveDevice :one
-- 每个需要认证的请求都会检查设备是否仍有效，让退出登录、吊销设备立即生效
SELECT * FROM devices
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: ListActiveDevices :many
SELECT * FROM devices
WHERE user_id = $1 AND revoked_at IS NULL
ORDER BY last_seen_at DESC;

-- name: RevokeDevice :execrows
UPDATE devices SET revoked_at = now()
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: RevokeOtherDevices :exec
UPDATE devices SET revoked_at = now()
WHERE user_id = $1 AND id <> sqlc.arg(keep_id) AND revoked_at IS NULL;
