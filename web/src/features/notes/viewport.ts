import { currentNoteSize } from './store'

export interface Viewport {
  left: number
  top: number
  width: number
  height: number
  /** 鼠标在画布上的位置（不在画布上时为 null） */
  pointer: { x: number; y: number } | null
  scrollTo: (left: number, top: number) => void
}

let getViewport: (() => Viewport | null) | null = null

export function setBoardViewport(fn: (() => Viewport | null) | null) {
  getViewport = fn
}

export const boardViewport = () => getViewport?.() ?? null

/** 新便利贴的落点：优先鼠标位置，否则可见区域中央，并带一点随机错位避免完全重叠 */
export function nextNotePosition() {
  const v = boardViewport()
  const size = currentNoteSize()
  const jitter = () => Math.round(Math.random() * 40 - 20)
  if (!v) return { x: 120 + jitter(), y: 120 + jitter() }
  const center = v.pointer ?? { x: v.left + v.width / 2, y: v.top + v.height / 2 }
  return {
    x: Math.max(8, Math.round(center.x - size.w / 2) + (v.pointer ? 0 : jitter())),
    y: Math.max(8, Math.round(center.y - size.h / 2) + (v.pointer ? 0 : jitter())),
  }
}
