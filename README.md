# Sticky-Do

便利贴 + 待办事项应用。第一期为 Go 服务端 + React Web 前端，后期支持 Android 与 iOS。

> 项目处于 M0 视觉原型阶段，设计文档见 [docs/](docs/README.md)。

## 运行 M0 原型

只有白板和便利贴的单页原型（数据存在浏览器 localStorage），用来打磨拖拽、配色和动效的手感。

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

双击空白处新建便利贴，按 `?` 查看全部快捷键。

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
