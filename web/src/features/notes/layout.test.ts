import { describe, expect, it } from 'vitest'
import { flowLayout, GRID } from './layout'
import type { Note } from './store'

const note = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, w, h }) as Note

describe('flowLayout', () => {
  it('不改大小，按阅读顺序一行行排，放不下就换行', () => {
    const notes = [
      note('c', 50, 600, 200, 100),
      note('a', 500, 10, 300, 280),
      note('b', 10, 300, 160, 140),
    ]
    // 可见宽度只够一行放两张：a(300) + gap + b(160)
    const width = 300 + GRID.gap + 160 + GRID.side * 2
    const pos = flowLayout(notes, width)
    // 阅读顺序：a（最上）、b、c
    expect(pos.get('a')).toEqual({ x: GRID.side, y: GRID.top })
    expect(pos.get('b')).toEqual({ x: GRID.side + 300 + GRID.gap, y: GRID.top })
    // 第二行在第一行最高的那张（a，280）下面
    expect(pos.get('c')).toEqual({ x: GRID.side, y: GRID.top + 280 + GRID.gap })
  })

  it('整体在可见宽度内水平居中', () => {
    const pos = flowLayout([note('a', 0, 0, 200, 100), note('b', 300, 0, 200, 100)], 1000)
    const blockWidth = 200 + GRID.gap + 200
    expect(pos.get('a')!.x).toBe(Math.round((1000 - blockWidth) / 2))
  })

  it('比可见宽度还宽的便利贴单独占一行', () => {
    const pos = flowLayout([note('a', 0, 0, 900, 100), note('b', 0, 300, 100, 100)], 500)
    expect(pos.get('a')).toEqual({ x: GRID.side, y: GRID.top })
    expect(pos.get('b')).toEqual({ x: GRID.side, y: GRID.top + 100 + GRID.gap })
  })
})
