import type { Note } from './store'

/** 网格排列参数：间距留出倾斜和阴影的空间，顶部避开顶栏（含第一行便利贴悬停时上方的操作栏） */
export const GRID = { gap: 28, top: 104, side: 32, bottom: 48 }

/** 按阅读顺序（先上后下、先左后右）排列，用于 J/K 切换焦点和自动排列 */
export const readingOrder = (notes: Note[]) =>
  [...notes].sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x))

/**
 * 把便利贴按阅读顺序排成网格（统一尺寸 w×h），在可见宽度内水平居中。
 * 返回每张便利贴的新位置。
 */
export function gridLayout(notes: Note[], size: { w: number; h: number }, viewportWidth: number) {
  const usable = Math.max(size.w, viewportWidth - GRID.side * 2)
  const cols = Math.max(1, Math.min(notes.length, Math.floor((usable + GRID.gap) / (size.w + GRID.gap))))
  const gridWidth = cols * size.w + (cols - 1) * GRID.gap
  const left = Math.max(GRID.side, Math.round((viewportWidth - gridWidth) / 2))
  const out = new Map<string, { x: number; y: number }>()
  readingOrder(notes).forEach((n, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    out.set(n.id, { x: left + col * (size.w + GRID.gap), y: GRID.top + row * (size.h + GRID.gap) })
  })
  return out
}
