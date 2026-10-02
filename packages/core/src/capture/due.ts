/**
 * 待办的到期时间与优先级：类型、显示和存储格式。不依赖解析器（chrono-node），
 * 显示便利贴、待办列表时只需要这个文件，快速记录的解析器可以按需加载。
 */

export type Priority = 0 | 1 | 2 | 3

/** 到期时间：本地日期（不带时区），可选具体时刻。跨时区时按“当地的这一天 / 这个时刻”理解 */
export interface Due {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm；只有日期时省略 */
  time?: string
}

export const PRIORITY_LABEL: Record<Priority, string> = { 0: '', 1: '低', 2: '中', 3: '高' }

export const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// ---------- 显示 ----------

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function dueToDate(due: Due): Date {
  const [y, m, d] = due.date.split('-').map(Number)
  const [hh, mm] = (due.time ?? '23:59').split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

/** “今天 15:00”“明天”“周三 9:30”“10月5日”“2027年1月3日” */
export function formatDue(due: Due, now: Date = new Date()): string {
  const [y, m, d] = due.date.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  const diff = Math.round((day.getTime() - startOfDay(now).getTime()) / 86400_000)
  let label: string
  if (diff === 0) label = '今天'
  else if (diff === 1) label = '明天'
  else if (diff === 2) label = '后天'
  else if (diff === -1) label = '昨天'
  else if (diff > 2 && diff < 7) label = WEEKDAY[day.getDay()]
  else if (y === now.getFullYear()) label = `${m}月${d}日`
  else label = `${y}年${m}月${d}日`
  return due.time ? `${label} ${due.time}` : label
}

export type DueStatus = 'overdue' | 'today' | 'upcoming'

/** 逾期：只有日期的过了这一天才算；有时刻的过了这个时刻就算 */
export function dueStatus(due: Due, now: Date = new Date()): DueStatus {
  if (dueToDate(due).getTime() < now.getTime()) return 'overdue'
  return due.date === ymd(now) ? 'today' : 'upcoming'
}

export function isDue(v: unknown): v is Due {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && (d.time === undefined || (typeof d.time === 'string' && /^\d{2}:\d{2}$/.test(d.time)))
}

// ---------- 存储格式 ----------

/** 待办项属性里的到期时间：“2026-10-03” 或 “2026-10-03T15:00”（本地时间，不带时区） */
export function dueToAttr(due: Due): string {
  return due.time ? `${due.date}T${due.time}` : due.date
}

export function dueFromAttr(v: unknown): Due | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(v)
  if (!m) return undefined
  return m[2] ? { date: m[1], time: m[2] } : { date: m[1] }
}
