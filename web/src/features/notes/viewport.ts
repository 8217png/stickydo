import { GRID } from './layout'
import { currentNoteSize, useNotes, visibleNotes } from './store'

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

/**
 * 新便利贴的落点：优先鼠标位置，否则可见区域中央，并带一点随机错位避免完全重叠。
 * preferCenter：从输入框创建时，鼠标位置没有意义：在可见区域里找离中央最近的空位，
 * 连续记录几条也不会叠在一起；没有空位再退回中央。
 */
export function nextNotePosition(opts: { preferCenter?: boolean } = {}) {
  const v = boardViewport()
  const size = currentNoteSize()
  const jitter = () => Math.round(Math.random() * 40 - 20)
  if (!v) {
    // 不在白板上（例如在待办列表里记录）：按窗口大小找一个空位
    const slot = opts.preferCenter && freeSlot({ left: 0, top: 56, width: window.innerWidth, height: window.innerHeight - 56, pointer: null, scrollTo: () => {} }, size)
    return slot || { x: 120 + jitter(), y: 120 + jitter() }
  }
  if (opts.preferCenter) {
    const slot = freeSlot(v, size)
    if (slot) return slot
  }
  const pointer = opts.preferCenter ? null : v.pointer
  const center = pointer ?? { x: v.left + v.width / 2, y: v.top + v.height / 2 }
  // 白板没有边界，坐标可以是负数
  return {
    x: Math.round(center.x - size.w / 2) + (pointer ? 0 : jitter()),
    y: Math.round(center.y - size.h / 2) + (pointer ? 0 : jitter()),
  }
}

const GAP = 16

/** 可见区域内、不与任何便利贴重叠、离中央最近的位置 */
function freeSlot(v: Viewport, size: { w: number; h: number }) {
  const notes = visibleNotes().filter((n) => !n.archived)
  const free = (x: number, y: number) =>
    notes.every((n) => x + size.w + GAP <= n.x || n.x + n.w + GAP <= x || y + size.h + GAP <= n.y || n.y + n.h + GAP <= y)
  const cx = v.left + v.width / 2 - size.w / 2
  const cy = v.top + v.height / 2 - size.h / 2
  const step = { x: size.w / 2 + GAP, y: size.h / 2 + GAP }
  const reach = { x: Math.floor(v.width / 2 / step.x), y: Math.floor(v.height / 2 / step.y) }
  const candidates: { x: number; y: number; d: number }[] = []
  for (let i = -reach.x; i <= reach.x; i++) {
    for (let j = -reach.y; j <= reach.y; j++) {
      const x = Math.round(cx + i * step.x)
      const y = Math.round(cy + j * step.y)
      if (x < v.left + 8 || y < v.top + 8) continue
      if (x + size.w > v.left + v.width || y + size.h > v.top + v.height) continue
      candidates.push({ x, y, d: (x - cx) ** 2 + (y - cy) ** 2 })
    }
  }
  candidates.sort((a, b) => a.d - b.d)
  const hit = candidates.find((c) => free(c.x, c.y))
  return hit && { x: hit.x, y: hit.y }
}

/**
 * 把便利贴移进可见范围（键盘切换焦点、从搜索 / 待办跳过去、快速记录之后）。
 * 白板上平移画布，移动最少的距离；列表视图里滚动列表。
 */
export function scrollNoteIntoView(id: string) {
  const v = boardViewport()
  const n = useNotes.getState().notes.find((x) => x.id === id)
  if (!v || !n) {
    document.querySelector(`[data-note="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    return
  }
  // 留出顶栏、便利贴上方的操作栏和四周的空白
  const nearest = (start: number, size: number, viewStart: number, viewSize: number, before: number, after: number) => {
    if (start - before < viewStart || size + before + after > viewSize) return start - before
    if (start + size + after > viewStart + viewSize) return start + size + after - viewSize
    return viewStart
  }
  const left = nearest(n.x, n.w, v.left, v.width, GRID.side, GRID.side)
  const top = nearest(n.y, n.h, v.top, v.height, GRID.top, GRID.bottom)
  if (left !== v.left || top !== v.top) v.scrollTo(left, top)
}
