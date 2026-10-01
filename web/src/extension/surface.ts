/**
 * 当前运行在哪种界面里：
 * - web：普通网页
 * - ext-popup：Chrome 插件点击图标弹出的浮窗
 * - ext-window：插件的独立窗口（可自由调整大小）
 * 由 public/boot.js 在首帧前根据 <html data-surface> 和 URL 写入 class。
 */
export type Surface = 'web' | 'ext-popup' | 'ext-window'

const root = document.documentElement
export const surface: Surface = root.classList.contains('ext-popup')
  ? 'ext-popup'
  : root.classList.contains('ext-window')
    ? 'ext-window'
    : 'web'

export const isExtension = surface !== 'web'
