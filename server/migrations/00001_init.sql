-- 初始数据模型（docs/architecture.md §4）
--
-- 可同步实体（boards、notes、todos、tags、item_tags）都带公共字段：
--   created_at, updated_at, deleted_at  软删除，删除也能同步到其他设备
--   version         取自 user_sync_seq，用户级全局递增，用于增量拉取
--   field_versions  每个字段最后一次被修改时的 version，用于字段级 LWW
-- ID 由客户端生成（UUIDv7），所以不设默认值。

-- +goose Up

CREATE TABLE users (
    id                  uuid        PRIMARY KEY,
    email               text        NOT NULL,
    password_hash       text        NOT NULL,
    name                text        NOT NULL DEFAULT '',
    password_changed_at timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
-- 邮箱不区分大小写唯一
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- 每台登录的设备一行；Refresh Token 只存哈希，每次刷新轮换
CREATE TABLE devices (
    id                      uuid        PRIMARY KEY,
    user_id                 uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name                    text        NOT NULL,
    platform                text        NOT NULL CHECK (platform IN ('web', 'extension', 'android', 'ios', 'other')),
    refresh_token_hash      bytea       NOT NULL,
    -- 上一个 Refresh Token 的哈希：如果它被再次使用，说明可能泄露，吊销整台设备
    prev_refresh_token_hash bytea,
    refresh_expires_at      timestamptz NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    last_seen_at            timestamptz NOT NULL DEFAULT now(),
    revoked_at              timestamptz
);
CREATE UNIQUE INDEX devices_refresh_token_hash_key ON devices (refresh_token_hash);
CREATE INDEX devices_prev_refresh_token_hash_idx ON devices (prev_refresh_token_hash)
    WHERE prev_refresh_token_hash IS NOT NULL;
CREATE INDEX devices_user_active_idx ON devices (user_id) WHERE revoked_at IS NULL;

-- 用户级全局递增序列：每次写入可同步实体时 +1，作为该记录的 version
CREATE TABLE user_sync_seq (
    user_id      uuid   PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    last_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE boards (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name           text        NOT NULL,
    color          text        NOT NULL DEFAULT '',
    -- 分数索引（fractional indexing），按字节序比较
    sort_order     text        COLLATE "C" NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    version        bigint      NOT NULL,
    field_versions jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX boards_user_version_idx ON boards (user_id, version);

CREATE TABLE notes (
    id             uuid             PRIMARY KEY,
    user_id        uuid             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- NULL 表示收件箱
    board_id       uuid             REFERENCES boards (id) ON DELETE CASCADE,
    title          text             NOT NULL DEFAULT '',
    -- Tiptap JSON
    content        jsonb            NOT NULL DEFAULT '{}',
    color          text             NOT NULL DEFAULT 'lemon',
    pinned         boolean          NOT NULL DEFAULT false,
    archived       boolean          NOT NULL DEFAULT false,
    -- 白板布局
    pos_x          double precision NOT NULL DEFAULT 0,
    pos_y          double precision NOT NULL DEFAULT 0,
    width          double precision NOT NULL DEFAULT 220,
    height         double precision NOT NULL DEFAULT 200,
    z_index        integer          NOT NULL DEFAULT 0,
    -- 列表排序
    sort_order     text             COLLATE "C" NOT NULL DEFAULT '',
    created_at     timestamptz      NOT NULL DEFAULT now(),
    updated_at     timestamptz      NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    version        bigint           NOT NULL,
    field_versions jsonb            NOT NULL DEFAULT '{}'
);
CREATE INDEX notes_user_version_idx ON notes (user_id, version);
CREATE INDEX notes_board_idx ON notes (board_id) WHERE deleted_at IS NULL;

-- 归属规则见 docs/architecture.md「待办的归属规则」，跨行约束（一层子任务、
-- board_id 与便利贴一致）由 Service 层校验
CREATE TABLE todos (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    board_id       uuid        REFERENCES boards (id) ON DELETE CASCADE,
    note_id        uuid        REFERENCES notes (id) ON DELETE CASCADE,
    parent_id      uuid        REFERENCES todos (id) ON DELETE CASCADE,
    title          text        NOT NULL DEFAULT '',
    done           boolean     NOT NULL DEFAULT false,
    done_at        timestamptz,
    due_at         timestamptz,
    -- 0 无、1 低、2 中、3 高
    priority       smallint    NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    sort_order     text        COLLATE "C" NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    version        bigint      NOT NULL,
    field_versions jsonb       NOT NULL DEFAULT '{}',
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX todos_user_version_idx ON todos (user_id, version);
CREATE INDEX todos_note_idx ON todos (note_id) WHERE deleted_at IS NULL;
CREATE INDEX todos_parent_idx ON todos (parent_id) WHERE deleted_at IS NULL;
-- “今天”“即将到期”“已逾期”视图
CREATE INDEX todos_user_due_idx ON todos (user_id, due_at) WHERE deleted_at IS NULL AND NOT done;

CREATE TABLE tags (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name           text        NOT NULL,
    color          text        NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    version        bigint      NOT NULL,
    field_versions jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX tags_user_version_idx ON tags (user_id, version);
CREATE UNIQUE INDEX tags_user_name_key ON tags (user_id, lower(name)) WHERE deleted_at IS NULL;

-- 打标签 = upsert 一条关联；去标签 = 软删除这条关联
CREATE TABLE item_tags (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tag_id         uuid        NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    item_type      text        NOT NULL CHECK (item_type IN ('note', 'todo')),
    item_id        uuid        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    version        bigint      NOT NULL,
    field_versions jsonb       NOT NULL DEFAULT '{}',
    -- 两台设备离线时给同一条内容打了同一个标签，服务端按此唯一键合并
    UNIQUE (tag_id, item_type, item_id)
);
CREATE INDEX item_tags_user_version_idx ON item_tags (user_id, version);
CREATE INDEX item_tags_item_idx ON item_tags (item_type, item_id) WHERE deleted_at IS NULL;

-- +goose Down

DROP TABLE item_tags;
DROP TABLE tags;
DROP TABLE todos;
DROP TABLE notes;
DROP TABLE boards;
DROP TABLE user_sync_seq;
DROP TABLE devices;
DROP TABLE users;
