import { cpSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 插件构建：把 manifest 和图标复制到输出目录 */
function chromeExtensionFiles(outDir: string): Plugin {
  return {
    name: 'stickydo-chrome-extension-files',
    apply: 'build',
    closeBundle() {
      cpSync(resolve(__dirname, 'extension/manifest.json'), resolve(outDir, 'manifest.json'))
      cpSync(resolve(__dirname, 'extension/icons'), resolve(outDir, 'icons'), { recursive: true })
    },
  }
}

// npm run build           → dist/            普通网页
// npm run build:extension → dist-extension/  Chrome 插件（在 chrome://extensions 里“加载已解压的扩展程序”）
export default defineConfig(({ mode }) => {
  if (mode === 'extension') {
    const outDir = resolve(__dirname, 'dist-extension')
    return {
      plugins: [react(), tailwindcss(), chromeExtensionFiles(outDir)],
      // 插件页面通过 chrome-extension:// 加载，使用相对路径
      base: './',
      build: {
        outDir,
        emptyOutDir: true,
        // MV3 默认 CSP 不允许内联脚本，Vite 的模块预加载 polyfill 会内联，关掉
        modulePreload: { polyfill: false },
        rollupOptions: { input: resolve(__dirname, 'popup.html') },
      },
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    // 开发时把 /api 转给本地 Go 服务（make dev）
    // ws: true 同时转发实时通知的 WebSocket（/api/v1/sync/ws）
    server: { proxy: { '/api': { target: 'http://localhost:8080', ws: true } } },
  }
})
