# 系统架构

## 1. 总览

```
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
│ React Web   │  │ Chrome 插件   │  │ Android(后期) │  │  iOS(后期)  │
│ IndexedDB   │  │ 本机存储      │  │  SQLite      │  │  SQLite     │   ← 每个端都有本地存储
└──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘
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
| 请求校验 | `kin-openapi`（经 `oapi-codegen/nethttp-middleware`）：字段校验和“哪些接口需要认证”都由 OpenAPI 决定 |
| 认证 | `golang-jwt`（HS256）、`x/crypto/argon2`（argon2id） |
| 配置与日志 | `envconfig`、`log/slog` |
| 测试 | `testcontainers-go`（连接真实的 Postgres） |

### Web 前端（React）

| 用途 | 选型 |
|---|---|
| 构建 | Vite + TypeScript |
| API 客户端 | `openapi-fetch` + `openapi-typescript` 生成的类型 |
| 路由 | React Router |
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

### Chrome 插件

- 与 Web 共用同一套 React 代码（`web/`），构建时以 `popup.html` 为入口，产物在 `web/dist-extension/`（Manifest V3）。
- 运行界面通过 `<html data-surface="extension">` 和 URL 区分：**浮窗**（`popup.html`）与**独立窗口**（`popup.html?window=1`，`chrome.windows.create({ type: 'popup' })`）。
- 浮窗大小：Chrome 插件浮窗不能原生拖边调整，由页面尺寸决定（上限 800×600）。左下角的把手修改页面尺寸，松手后记住；`public/boot.js` 在首帧前恢复，避免闪动。
- 独立窗口：自由调整大小，用 `chrome.windows.onBoundsChanged` 记住大小和位置；已打开时再点按钮直接切过去。
- MV3 默认 CSP 禁止内联脚本和远程代码：首帧脚本放在 `public/boot.js`，不加载在线字体。
- 存储：M0 阶段用插件源下的 localStorage，浮窗与独立窗口通过 `storage` 事件实时同步；之后与 Web 一起换成 IndexedDB（Dexie），登录后走统一的同步协议。

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
item_tags    (id, user_id, tag_id, item_type, item_id,   -- 关联本身也是可同步实体
              ...公共字段)                                -- UNIQUE (tag_id, item_type, item_id)

-- 公共字段：created_at, updated_at, deleted_at, version BIGINT,
--           field_versions JSONB                        -- 每个字段最后一次被修改时的 version，用于字段级 LWW
```

- `item_tags` 同样带公共字段：打标签就是 upsert 一条关联，去标签就是软删除这条关联，因此可以和其他实体一样增量同步。`id` 由客户端生成（UUIDv7）；如果两台设备离线时给同一条内容打了同一个标签，服务端按唯一键合并为一条。

### 待办的归属规则

`todos` 有三个可空的归属字段，约束如下（由服务端在 Service 层校验，违反时返回 422）：

| 情况 | `note_id` | `board_id` | `parent_id` |
|---|---|---|---|
| 收件箱里的独立待办 | NULL | NULL | NULL |
| 看板里的独立待办 | NULL | 看板 ID | NULL |
| 便利贴里的待办（checklist） | 便利贴 ID | **必须等于该便利贴的 `board_id`**（冗余字段，便于按看板查询） | NULL |
| 子任务 | 与父任务相同 | 与父任务相同 | 父任务 ID |

- **只有一层子任务**：父任务自身的 `parent_id` 必须为 NULL。
- **跟随移动**：便利贴换看板时，其中的待办 `board_id` 一起更新；父任务移动（换看板、拖进或拖出便利贴）时，子任务一起移动。这些级联修改在同一个事务里完成，并各自获得新的 `version`，其他设备照常同步。
- **级联删除**：删除便利贴或父任务时，其中的待办和子任务一起软删除；撤销时一起恢复。

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

- **`data` 是补丁，不是整条记录**：`op: "upsert"` 时，`data` 只包含本次修改过的字段（新建时包含全部字段）。客户端待推送队列中，同一条记录的多次修改会合并成一个补丁。
- **冲突策略**：第一期采用**字段级的“最后写入者胜”（LWW）**，“后写入”指**后到达服务端**：
  1. 服务端在事务中为本次写入分配新的 `version`，把补丁里的字段逐个写入，并把这些字段在 `field_versions` 中的值更新为新 `version`。补丁里没有的字段保持不变，所以不同字段的并发修改会全部保留。
  2. 对补丁里的每个字段，如果它在 `field_versions` 中的值大于 `base_version`，说明在客户端上次拉取之后，别的设备也改过这个字段。此时仍以本次写入为准，但把该字段及被覆盖的旧值放进响应的 `conflicts`，客户端可以提示用户，或提供“恢复对方版本”的操作。
  3. 删除（`op: "delete"`）同样按到达顺序处理：删除之后再到达的 upsert 会让记录“复活”（清空 `deleted_at`），避免离线编辑丢失。
- 二期做多人协作时，对 `content` 字段引入 CRDT（Yjs），该字段不再走 LWW。
- **客户端流程**：
  1. 用户操作先写入本地数据库（IndexedDB 或 SQLite），UI 立即更新（乐观更新）。
  2. 变更进入待推送队列，由后台执行 push。
  3. 收到 WebSocket 通知后执行 pull，再合并到本地。

除同步接口外，也提供常规的 REST CRUD 接口（`/notes`、`/todos`、`/boards`、`/search`），方便调试和第三方集成。

## 6. 认证（M1 已实现）

接口见 `api/openapi.yaml`（`/auth/*`、`/me/*`），实现在 `server/internal/service/auth.go`。

- **密码**：argon2id（19 MiB、2 次迭代、1 线程，参数写在哈希串里，以后可调高）。未注册的邮箱登录也照样算一次哈希，使“邮箱不存在”和“密码错误”的耗时与提示一致，避免探测已注册邮箱。
- **Access Token**：JWT（HS256），15 分钟，内容是用户 ID 和设备 ID。每个需要认证的请求都会确认设备未被吊销，所以退出登录、吊销设备、改密码后其他设备退出都**立即生效**。
- **Refresh Token**：256 位随机串，数据库只存 SHA-256；按设备记录，30 天，每次刷新都轮换并顺延。
  - **重用检测**：已轮换掉的旧 Token 在 60 秒后再被使用，视为泄露，吊销整台设备。
  - **60 秒宽限**：同一浏览器的多个标签页可能同时刷新，宽限期内旧 Token 只是失败、不吊销；客户端收到 401 后从 localStorage 读取别的标签页刚拿到的新 Token 再试。
- **设备**：登录即创建一条设备记录（名称、平台）；`GET /me/devices` 列出，`DELETE /me/devices/{id}` 让某台设备退出。改密码时当前设备保持登录，其他设备全部退出。
- **限流**：注册、登录、刷新按 IP 限流（每 6 秒补 1 次，最多连续 10 次），超出返回 429 + `Retry-After`。M1 是单实例内存实现，多实例时换成 Redis。部署在反向代理后面时打开 `STICKYDO_TRUST_PROXY` 才信任 `X-Forwarded-For`。
- **错误格式**：统一 `application/problem+json`（RFC 9457），`code` 给程序判断（如 `token_expired` 表示该刷新了），`fields` 一次给出所有字段错误。
- **Web 客户端**（`web/src/features/auth/session.ts`）：Refresh Token 与用户信息存 localStorage，Access Token 只放内存；请求前剩余不足 30 秒就先刷新（同一时间只发一个刷新请求），遇到 401 刷新后重试一次；多个标签页通过 `storage` 事件共享登录状态，一处退出处处退出。
- **账号是可选的**：不登录也能完整使用白板（数据在本机）；Chrome 插件目前完全单机，不显示账号入口。

## 7. 项目目录（Monorepo）

```
sticky-do/
├── api/
│   └── openapi.yaml            # 唯一的接口定义来源
├── server/                     # Go
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── config/             # 环境变量（前缀 STICKYDO_）
│   │   ├── apperr/             # 业务错误 → problem+json
│   │   ├── auth/               # 密码哈希、JWT、Refresh Token
│   │   ├── db/                 # 连接池、goose 迁移
│   │   ├── http/               # 路由、中间件（日志、CORS、限流、OpenAPI 校验与认证）、handler
│   │   │   └── api/            # oapi-codegen 生成代码
│   │   ├── service/            # 业务逻辑：auth（M1），note、todo、board、sync（M2 起）
│   │   ├── repo/               # sqlc 生成代码
│   │   ├── realtime/           # WebSocket hub（M5）
│   │   └── jobs/               # 回收站清理、提醒调度（二期）
│   ├── migrations/             # goose 迁移（嵌入二进制，启动时执行）
│   ├── queries/                # sqlc 使用的 .sql 文件
│   ├── tools/                  # 代码生成工具（sqlc、oapi-codegen、goose）的独立 go.mod
│   └── Dockerfile
├── web/                        # React（Web 与 Chrome 插件共用）
│   ├── index.html              # Web 入口
│   ├── popup.html              # Chrome 插件入口（浮窗 / 独立窗口）
│   ├── extension/              # manifest.json、图标
│   └── src/
│       ├── api/                # OpenAPI 生成的类型（schema.d.ts）与客户端
│       ├── sync/               # 本地数据库 + 同步引擎（后期可抽成共享包）
│       ├── design/             # 设计 token、主题
│       ├── extension/          # 插件专用：浮窗尺寸、独立窗口
│       ├── features/{notes,todos,boards,auth,capture}/
│       ├── components/         # 含 ui/ 基础组件（Storybook：npm run storybook）
│       └── routes/             # 白板页、登录 / 注册页
├── docs/                       # 设计文档
├── deploy/
│   └── docker-compose.yml      # postgres + redis + server
└── Makefile                    # make gen / db / dev / web / test / up
```

### 代码生成

- `make gen`：由 `api/openapi.yaml` 生成 Go（oapi-codegen）与 TS 类型（openapi-typescript），由 `migrations/` + `queries/` 生成 sqlc 代码。生成的文件都提交到仓库。
- Go 工具放在 `server/tools/go.mod`（`go tool -modfile=tools/go.mod ...`），不污染服务端依赖。
- openapi-typescript 依赖 TypeScript 5 的编译器 API，而前端用 TypeScript 7（没有 JS API），所以 `npm run gen:api` 通过 `npx` 临时使用固定版本的 openapi-typescript + TypeScript 5。
