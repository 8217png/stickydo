/**
 * 排序键（分数索引的简化版，docs/architecture.md「sort_order」）：0-9a-z 组成的字符串，按字节序比较。
 * 拖动排序时只给被移动的那一条换一个夹在前后两条之间的新键，其他记录不变，多端同步也不容易冲突。
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

const digit = (c: string) => {
  const i = DIGITS.indexOf(c)
  if (i < 0) throw new Error(`排序键里有不支持的字符：${c}`)
  return i
}

/**
 * 返回严格位于 a 与 b 之间的键：a < 结果 < b。a 为空表示没有下界，b 为 null 表示没有上界。
 * 结果不以 0 结尾，保证之后总能在它前后再插入。a >= b（或包含不支持的字符）时抛错。
 */
export function keyBetween(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`排序键顺序不对：${a} >= ${b}`)
  let out = ''
  let upper = b
  for (let i = 0; ; i++) {
    const lo = i < a.length ? digit(a[i]) : 0
    const hi = upper !== null ? (i < upper.length ? digit(upper[i]) : 0) : BASE
    if (upper !== null && lo === hi) {
      out += DIGITS[lo]
      continue
    }
    const mid = Math.floor((lo + hi) / 2)
    if (mid > lo) return out + DIGITS[mid]
    // 前后只差一位：沿用 a 这一位，之后只需要比 a 大
    out += DIGITS[lo]
    upper = null
  }
}

/** 是不是能用来比较和插入的排序键 */
export const isSortKey = (k: string) => k.length > 0 && /^[0-9a-z]+$/.test(k) && !k.endsWith('0')
