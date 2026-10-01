import { load, save } from '../lib/storage'

/** 浮窗尺寸范围：Chrome 插件浮窗最大 800×600（与 public/boot.js 保持一致） */
export const POPUP = { min: { w: 320, h: 360 }, max: { w: 800, h: 600 }, default: { w: 480, h: 560 } }
const KEY = 'stickydo.ext.popupSize'

export function clampPopupSize(w: number, h: number) {
  return {
    w: Math.round(Math.min(POPUP.max.w, Math.max(POPUP.min.w, w))),
    h: Math.round(Math.min(POPUP.max.h, Math.max(POPUP.min.h, h))),
  }
}

export function currentPopupSize() {
  const s = load<{ w: number; h: number }>(KEY) ?? POPUP.default
  return clampPopupSize(s.w, s.h)
}

/** 应用浮窗尺寸：改 body 的大小，Chrome 会让浮窗跟着变 */
export function applyPopupSize(w: number, h: number, persist: boolean) {
  const s = clampPopupSize(w, h)
  const root = document.documentElement
  root.style.setProperty('--popup-w', `${s.w}px`)
  root.style.setProperty('--popup-h', `${s.h}px`)
  if (persist) save(KEY, s)
  return s
}
