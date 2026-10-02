# Sticky-Do

便利贴 + 待办事项应用。第一期为 Go 服务端 + React Web 前端，后期支持 Android 与 iOS。

> 当前进度：M2（Tiptap 编辑器、本地优先 + 登录后同步）已完成，设计文档见 [docs/](docs/README.md)。

## 本地开发

需要 Go 1.26+、Node 22+、Docker。

```bash
make db      # 启动 PostgreSQL + Redis（Docker）
make dev     # 启动 API 服务 :8080（启动时自动执行数据库迁移）
make web     # 另开终端：启动前端 :5173，/api 自动代理到 :8080
```

打开 http://localhost:5173 。不登录也能用白板（数据保存在浏览器里）；右上角注册、登录后，便利贴在多台设备间同步：逐条比较，哪边新以哪边为准（规则见 [architecture.md §5](docs/architecture.md)）。

| 命令 | 作用 |
|---|---|
| `make gen` | 改了 `api/openapi.yaml` 或 SQL 之后，重新生成 Go / TS 代码 |
| `make test` | 服务端测试（含连真实 PostgreSQL 的集成测试，需要 Docker）+ 前端类型检查与单元测试 |
| `make up` | 用 docker compose 启动全部服务（PostgreSQL、Redis、API） |
| `cd web && npm run storybook` | 基础组件和页面的 Storybook（:6006） |

服务端配置用环境变量（前缀 `STICKYDO_`），见 `server/internal/config/config.go`。部署时务必设置随机生成的 `STICKYDO_JWT_SECRET`（至少 32 个字符）。

## Chrome 插件（单机版）

不登录、不连服务器也能用，数据保存在本机。

```bash
cd web
npm install
npm run build:extension   # 输出到 web/dist-extension/
```

1. 打开 `chrome://extensions`，右上角开启「开发者模式」
2. 点「加载已解压的扩展程序」，选择 `web/dist-extension` 目录
3. 把 Sticky-Do 固定到工具栏，点击图标（或按 `Alt+Shift+S`）打开浮窗

- 拖浮窗左下角的把手调整大小，会记住；双击把手恢复默认大小。浮窗最大 800×600（Chrome 的限制）
- 点浮窗右上角的 ↗ 在独立窗口打开，独立窗口可以自由调整大小，大小和位置也会记住

## License

[MIT](LICENSE)
