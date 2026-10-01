# 系统架构

## 1. 总览

```
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│ React Web   │  │ Android(后期) │  │  iOS(后期)  │
│ IndexedDB   │  │  SQLite      │  │  SQLite     │   ← 每个端都有本地存储
└──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       │ REST (OpenAPI) + WebSocket(实时通知)
       ▼
┌──────────────────────────────────────────────┐
│              Go API Server                   │
│  Handler → Service → Repository              │
│  Auth(JWT) │ Sync 引擎 │ 实时 Hub │ 定时任务   │
└──────┬──────────────┬───────────────┬────────┘
       ▼              ▼               ▼
  PostgreSQL        Redis          对象存储(二期)
  (主数据)      (Pub/Sub、限流)   (S3/MinIO 附件)
```

## 2. 面向多端的关键决策

1. **API First**：以 `api/openapi.yaml` 作为唯一的接口定义来源，Go 服务端和 TS 客户端都由它生成代码，后续的 Kotlin/Swift 客户端同样可以生成。
2. **基于 Token 的认证，不依赖 Cookie**：Access Token 有效期 15 分钟；Refresh Token 有效期 30 天，按设备记录，可以单独吊销。Web 和 App 共用这一套机制。
3. **由客户端生成 ID**：使用 UUIDv7，离线时也能直接创建数据。
4. **增量同步协议**：从第一天起采用“本地优先 + 同步”的模型（见第 5 节）。
5. **软删除**：所有实体都有 `deleted_at` 字段，删除操作也能同步到其他设备。

## 3. 技术选型

### 服务端（Go）

| 用途 | 选型 |
|---|---|
| HTTP 路由 | `chi` |
| API 定义与代码生成 | OpenAPI 3 + `oapi-codegen` |
| 数据库访问 | `sqlc` + `pgx` |
| 数据库迁移 | `goose` |
| 实时推送 | `coder/websocket`，多实例时通过 Redis Pub/Sub 广播 |
| 配置与日志 | `envconfig`、`log/slog` |
| 测试 | `testcontainers-go`（连接真实的 Postgres） |

### Web 前端（React）

| 用途 | 选型 |
|---|---|
| 构建 | Vite + TypeScript |
| 服务端状态 | TanStack Query |
| 本地状态与撤销栈 | Zustand（撤销通过中间件实现） |
| 本地存储 | Dexie（IndexedDB）：离线缓存与待推送队列 |
| UI 基础 | Tailwind + shadcn/ui（Radix UI） |
| 动效 | Motion（原 Framer Motion） |
| 命令面板 | cmdk |
| 提示与撤销条 | sonner |
| 拖拽 | `dnd-kit`（列表排序）+ `react-rnd`（白板中自由拖拽和缩放） |
| 富文本 | Tiptap（支持 Markdown 快捷输入） |
| 自然语言时间解析 | chrono-node + 自定义中文规则 |
| 快捷键 | tinykeys |
| 组件开发 | Storybook |

### 移动端（后期）

- **React Native (Expo)**：可以复用 API 客户端、同步逻辑、类型定义和设计 token。
- **原生开发（Kotlin + Swift）**：原生体验和 Widget 能力更好。

同步协议与平台无关，两条路线都走得通（待决，见 [roadmap.md](roadmap.md)）。

## 4. 数据模型

```sql
users        (id, email, password_hash, name, created_at, ...)
devices      (id, user_id, name, platform, refresh_token_hash, last_seen_at)

boards       (id, user_id, name, color, sort_order, ...公共字段)

notes        (id, user_id, board_id, title, content,      -- content 为 Tiptap JSON
              color, pinned, archived,
              pos_x, pos_y, width, height, z_index,       -- 白板布局
              sort_order,                                 -- 列表排序（分数索引）
              ...公共字段)

todos        (id, user_id, board_id NULL, note_id NULL,   -- 可以独立，也可以属于某张便利贴
              parent_id NULL,                             -- 子任务
              title, done, done_at, due_at, priority,
              sort_order, ...公共字段)

tags         (id, user_id, name, color, ...公共字段)
item_tags    (tag_id, item_type, item_id)

-- 公共字段：created_at, updated_at, deleted_at, version BIGINT
```

- `sort_order` 采用**分数索引**（fractional indexing，字符串类型）：拖拽排序时只需更新一条记录，多端同步时也不容易冲突。
- `version` 取自用户级的全局递增序列（`user_sync_seq`），用于增量拉取。

## 5. 同步协议

```
POST /api/v1/sync/push   客户端推送本地变更
  { changes: [{ entity: "note", id, op: "upsert|delete", data, base_version }] }
  ← { applied: [...], conflicts: [...], server_version }

GET  /api/v1/sync/pull?since=<version>
  ← { changes: [...所有 version > since 的记录，包括软删除的...], server_version }

WS   /api/v1/ws          服务端通知“有新版本”，客户端收到后执行 pull
```

- **冲突策略**：第一期采用**字段级的“最后写入者胜”（LWW）**。不同字段的并发修改会全部保留，只有同一字段被同时修改时，才以后写入的为准。二期做多人协作时，对 `content` 字段引入 CRDT（Yjs）。
- **客户端流程**：
  1. 用户操作先写入本地数据库（IndexedDB 或 SQLite），UI 立即更新（乐观更新）。
  2. 变更进入待推送队列，由后台执行 push。
  3. 收到 WebSocket 通知后执行 pull，再合并到本地。

除同步接口外，也提供常规的 REST CRUD 接口（`/notes`、`/todos`、`/boards`、`/search`），方便调试和第三方集成。

## 6. 项目目录（Monorepo）

```
sticky-do/
├── api/
│   └── openapi.yaml            # 唯一的接口定义来源
├── server/                     # Go
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── config/
│   │   ├── http/               # handler、中间件（认证、日志、限流、CORS）
│   │   ├── service/            # 业务逻辑：note、todo、board、sync、auth
│   │   ├── repo/               # sqlc 生成代码
│   │   ├── realtime/           # WebSocket hub
│   │   └── jobs/               # 回收站清理、提醒调度（二期）
│   ├── migrations/
│   └── queries/                # sqlc 使用的 .sql 文件
├── web/                        # React
│   └── src/
│       ├── api/                # 根据 OpenAPI 生成的客户端
│       ├── sync/               # 本地数据库 + 同步引擎（后期可抽成共享包）
│       ├── design/             # 设计 token、主题
│       ├── features/{notes,todos,boards,auth,capture}/
│       ├── components/
│       └── routes/
├── docs/                       # 设计文档
├── deploy/
│   └── docker-compose.yml      # postgres + redis + server + web
└── Makefile                    # make gen / make dev / make test
```
