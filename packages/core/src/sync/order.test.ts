import { describe, expect, it } from 'vitest'
import { isSortKey, keyBetween } from './order'

describe('keyBetween', () => {
  it('结果严格位于两者之间，且不以 0 结尾', () => {
    for (const [a, b] of [
      ['', null],
      ['a', null],
      ['', 'a'],
      ['a', 'b'],
      ['a', 'a1'],
      ['az', 'b'],
      ['zzz', null],
      ['0001', '0002'],
      ['mg9zq1ab', 'mg9zq1ac'],
    ] as const) {
      const k = keyBetween(a, b)
      expect(k > a, `${a} < ${k}`).toBe(true)
      if (b !== null) expect(k < b, `${k} < ${b}`).toBe(true)
      expect(isSortKey(k), k).toBe(true)
    }
  })

  it('反复在同一个位置插入也不会用完', () => {
    let lo = 'a'
    const hi = 'b'
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(lo, hi)
      expect(k > lo && k < hi).toBe(true)
      lo = k
    }
    let up = 'b'
    for (let i = 0; i < 200; i++) {
      const k = keyBetween('a', up)
      expect(k > 'a' && k < up).toBe(true)
      up = k
    }
  })

  it('顺序不对时抛错', () => {
    expect(() => keyBetween('b', 'a')).toThrow()
    expect(() => keyBetween('a', 'a')).toThrow()
  })
})
