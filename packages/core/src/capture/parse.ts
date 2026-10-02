import * as chrono from 'chrono-node'
import { type Due, formatDue, hm, PRIORITY_LABEL, type Priority, startOfDay, ymd } from './due'

export type { Due, Priority }

/**
 * 快速记录的解析（docs/frontend-design.md §2.1）。
 * 与平台无关：Web 和移动端共用。只依赖 Date，不用任何浏览器对象。
 *
 *   买牛奶                              → 便利贴
 *   [] 买牛奶 明天下午3点 !高 #生活      → 待办：标题“买牛奶”，到期明天 15:00，优先级高，标签“生活”
 *
 * 只有以 [] 开头时才按待办解析时间、优先级和标签；普通文字原样保存为便利贴，不会被误改。
 */

export type CaptureTokenKind = 'todo' | 'due' | 'priority' | 'tag'

/** 输入里被识别出的一段，用于在输入框中高亮 */
export interface CaptureToken {
  kind: CaptureTokenKind
  start: number
  end: number
  /** 给人看的说明，例如“明天 15:00”“高”“#生活” */
  label: string
}

export interface Capture {
  kind: 'note' | 'todo'
  /** 去掉已识别部分后的文字 */
  title: string
  due?: Due
  priority: Priority
  tags: string[]
  tokens: CaptureToken[]
}

const TODO_MARK = /^\s*(?:[-*]\s*)?\[\s?\]\s*/

export function parseCapture(input: string, now: Date = new Date()): Capture {
  const mark = TODO_MARK.exec(input)
  if (!mark) return { kind: 'note', title: input.trim(), priority: 0, tags: [], tokens: [] }

  const tokens: CaptureToken[] = [{ kind: 'todo', start: 0, end: mark[0].length, label: '待办' }]
  // 已识别的位置用空格盖住，后面的识别不会重复匹配，位置也保持不变
  let masked = ' '.repeat(mark[0].length) + input.slice(mark[0].length)
  const mask = (start: number, end: number) => {
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end)
  }

  // ---- 标签：#生活（前面是开头或空白，避免把 C# 当标签） ----
  const tags: string[] = []
  for (const m of masked.matchAll(/(^|\s)[#＃]([\p{L}\p{N}_\-/·]+)/gu)) {
    const start = m.index + m[1].length
    const end = m.index + m[0].length
    const tag = m[2]
    if (!tags.includes(tag)) tags.push(tag)
    tokens.push({ kind: 'tag', start, end, label: `#${tag}` })
  }
  for (const t of tokens) if (t.kind === 'tag') mask(t.start, t.end)

  // ---- 优先级：!高 !中 !低、!!! !!、!high !med !low（后出现的为准） ----
  let priority: Priority = 0
  for (const m of masked.matchAll(/(^|\s)[!！](高|中|低|!!|！！|!|！|high|medium|med|low|h|m|l)(?=\s|$)/giu)) {
    const p = PRIORITY_WORDS[m[2].toLowerCase()]
    if (!p) continue
    const start = m.index + m[1].length
    const end = m.index + m[0].length
    priority = p
    tokens.push({ kind: 'priority', start, end, label: PRIORITY_LABEL[p] })
  }
  for (const t of tokens) if (t.kind === 'priority') mask(t.start, t.end)

  // ---- 到期时间 ----
  const found = findDue(masked, now)
  let due: Due | undefined
  if (found) {
    due = found.due
    tokens.push({ kind: 'due', start: found.start, end: found.end, label: formatDue(due, now) })
    mask(found.start, found.end)
  }

  const title = masked.replace(/\s+/g, ' ').trim()
  tokens.sort((a, b) => a.start - b.start)
  return { kind: 'todo', title, due, priority, tags, tokens }
}

const PRIORITY_WORDS: Record<string, Priority> = {
  高: 3, 中: 2, 低: 1,
  '!!': 3, '！！': 3, '!': 2, '！': 2,
  high: 3, h: 3, medium: 2, med: 2, m: 2, low: 1, l: 1,
}


// ---------- 到期时间 ----------

interface FoundDue {
  due: Due
  start: number
  end: number
}

function findDue(text: string, now: Date): FoundDue | null {
  return findCustom(text, now) ?? findChrono(text, now)
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function cnNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s)
  // 一 ~ 三十一
  if (s.length === 1) return CN_NUM[s] ?? NaN
  const [a, b, c] = [...s]
  if (a === '十') return 10 + (CN_NUM[b] ?? NaN)
  if (b === '十') return (CN_NUM[a] ?? NaN) * 10 + (c ? (CN_NUM[c] ?? NaN) : 0)
  return NaN
}

/** 跟在“N号”后面时说明不是日期的字：5号楼、1号线…… */
const NOT_A_DATE_AFTER_HAO = /^[线楼房室位门口机车厅馆院座床桌柜箱码键球选手]/

/** chrono 不认识的常用中文说法 */
function findCustom(text: string, now: Date): FoundDue | null {
  const today = startOfDay(now)
  const rules: { re: RegExp; date: (m: RegExpExecArray) => Date | null }[] = [
    // 下个月1号 / 下月15日
    {
      re: /下个?月([0-9]{1,2}|[一二三四五六七八九十]{1,3})[号日]/,
      date: (m) => monthDay(today.getFullYear(), today.getMonth() + 1, cnNumber(m[1])),
    },
    // 月底
    { re: /(?:这个?|本)?月底/, date: () => new Date(today.getFullYear(), today.getMonth() + 1, 0) },
    // 周末（本周六；今天已是周末则为今天）
    {
      re: /(?:这个?|本)?(?:周末|礼拜天?末)/,
      date: () => (today.getDay() === 6 || today.getDay() === 0 ? today : addDays(today, 6 - today.getDay())),
    },
    // 5号 / 20日：本月这一天，已过则下个月
    {
      re: /(?<![0-9月])([0-9]{1,2}|[一二三四五六七八九十]{1,3})[号日]/,
      date: (m) => {
        const after = text.slice(m.index + m[0].length)
        if (NOT_A_DATE_AFTER_HAO.test(after)) return null
        const day = cnNumber(m[1])
        const thisMonth = monthDay(today.getFullYear(), today.getMonth(), day)
        if (!thisMonth) return null
        return thisMonth < today ? monthDay(today.getFullYear(), today.getMonth() + 1, day) : thisMonth
      },
    },
  ]
  for (const r of rules) {
    const m = r.re.exec(text)
    if (!m) continue
    const d = r.date(m)
    if (!d) continue
    // 后面紧跟的时刻（例如“5号下午3点”）交给 chrono 识别时刻
    const rest = text.slice(m.index + m[0].length)
    const time = /^\s*(?:早上|上午|中午|下午|晚上|今晚|凌晨)?\s*[0-9一二三四五六七八九十两]{1,3}\s*(?:点|:|：)/.exec(rest)
    let end = m.index + m[0].length
    let timeStr: string | undefined
    if (time) {
      const t = chrono.zh.hans.parse(rest, d, { forwardDate: false })[0]
      if (t && t.index === 0 && t.start.isCertain('hour')) {
        timeStr = hm(fixMeridiem(t, d)) // 日期已由上面的规则确定，这里只取时刻
        end += t.text.length
      }
    }
    return { due: { date: ymd(d), ...(timeStr ? { time: timeStr } : {}) }, start: m.index, end }
  }
  return null
}

function monthDay(year: number, month: number, day: number): Date | null {
  if (!Number.isFinite(day) || day < 1 || day > 31) return null
  const d = new Date(year, month, day)
  return d.getDate() === day ? d : null // 2 月 30 号之类的不合法日期
}

/** 没说上午 / 下午时，1–7 点按下午理解（“2点开会”通常是 14:00） */
function fixMeridiem(r: chrono.ParsedResult, now: Date): Date {
  const d = r.start.date()
  const h = d.getHours()
  if (r.start.isCertain('meridiem') || h < 1 || h > 7) return d
  if (r.start.isCertain('day') || r.start.isCertain('weekday')) {
    d.setHours(h + 12)
    return d
  }
  // 只说了几点：chrono 按凌晨算时可能已经顺延到明天（10 点说“3点” → 明天 3:00），
  // 改成下午后重新判断：今天的 15:00 还没到就是今天
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h + 12, d.getMinutes())
  if (today < now) today.setDate(today.getDate() + 1)
  return today
}

function findChrono(text: string, now: Date): FoundDue | null {
  const results = [...chrono.zh.hans.parse(text, now, { forwardDate: true })]
  if (results.length === 0) results.push(...chrono.en.parse(text, now, { forwardDate: true }))
  for (const r of results) {
    const c = r.start
    // 至少要确定到“哪一天 / 星期几 / 几点”，“三月份”这种不算
    if (!c.isCertain('day') && !c.isCertain('weekday') && !c.isCertain('hour')) continue
    let start = r.index
    let end = r.index + r.text.length
    let date = c.isCertain('hour') ? fixMeridiem(r, now) : c.date()

    // “本周五 / 这周五”：把前缀算进去；“下下周一”：再加一周
    const before = text.slice(0, start)
    if (/(本|这)$/.test(before) && /^(周|星期|礼拜)/.test(r.text)) start -= 1
    if (/下$/.test(before) && /^下(周|星期|礼拜)/.test(r.text)) {
      start -= 1
      date = new Date(date.getTime() + 7 * 86400_000)
    }
    // chrono 的匹配可能带上前后的空白（包括被遮住的标签、优先级），去掉
    while (end > start && /\s/.test(text[end - 1])) end--
    while (start < end && /\s/.test(text[start])) start++
    const due: Due = { date: ymd(date) }
    if (c.isCertain('hour')) due.time = hm(date)
    return { due, start, end }
  }
  return null
}
