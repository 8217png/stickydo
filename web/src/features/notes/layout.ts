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

/**
 * 重新排列（不改大小）：按阅读顺序从左到右摆，一行放不下就换行；每行的高度取这一行最高的那张，
 * 整体在可见宽度内水平居中。便利贴大小各不相同也排得整齐，返回每张的新位置。
 */
export function flowLayout(notes: Note[], viewportWidth: number) {
  const ordered = readingOrder(notes)
  const widest = Math.max(0, ...ordered.map((n) => n.w))
  const usable = Math.max(widest, viewportWidth - GRID.side * 2)
  const rows: { items: Note[]; width: number; height: number }[] = []
  for (const n of ordered) {
    const row = rows.at(-1)
    if (row && row.width + GRID.gap + n.w <= usable) {
      row.items.push(n)
      row.width += GRID.gap + n.w
      row.height = Math.max(row.height, n.h)
    } else rows.push({ items: [n], width: n.w, height: n.h })
  }
  const blockWidth = Math.max(0, ...rows.map((r) => r.width))
  const left = Math.max(GRID.side, Math.round((viewportWidth - blockWidth) / 2))
  const out = new Map<string, { x: number; y: number }>()
  let y = GRID.top
  for (const row of rows) {
    let x = left
    for (const n of row.items) {
      out.set(n.id, { x, y })
      x += n.w + GRID.gap
    }
    y += row.height + GRID.gap
  }
  return out
}
