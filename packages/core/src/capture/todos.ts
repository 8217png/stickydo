import type { JSONContent, NoteDoc } from '../notes/doc'
import { type Due, dueToDate, type Priority } from './due'
import { todoMeta } from './todo'

/**
 * 待办汇总（docs/frontend-design.md「待办视图」）：待办存在便利贴正文里，
 * 今天 / 即将 / 已完成 / 标签这些视图都是从所有便利贴里实时汇总出来的。
 */

export interface TodoRef {
  noteId: string
  /** 待办项在正文中的位置（逐层的 content 下标），勾选时用 */
  path: number[]
  /** 待办项自己的文字（不含子列表） */
  text: string
  checked: boolean
  due?: Due
  priority: Priority
  tags: string[]
  /** 所在便利贴最后一次编辑的时间，“已完成”按它排序 */
  updatedAt: number
}

interface NoteLike {
  id: string
  content: NoteDoc
  updatedAt: number
}

function inlineText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return ' '
  return (node.content ?? []).map(inlineText).join('')
}

/** 收集所有便利贴里的待办项（包括嵌套的），按便利贴顺序、正文顺序排列 */
export function collectTodos(notes: NoteLike[]): TodoRef[] {
  const out: TodoRef[] = []
  for (const n of notes) {
    const walk = (node: JSONContent, path: number[]) => {
      if (node.type === 'taskItem') {
        const meta = todoMeta(node.attrs)
        const text = (node.content ?? [])
          .filter((c) => c.type !== 'taskList' && c.type !== 'bulletList' && c.type !== 'orderedList')
          .map(inlineText)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        out.push({
          noteId: n.id,
          path,
          text,
          checked: node.attrs?.checked === true,
          ...(meta.due ? { due: meta.due } : {}),
          priority: meta.priority,
          tags: meta.tags,
          updatedAt: n.updatedAt,
        })
      }
      ;(node.content ?? []).forEach((c, i) => walk(c, [...path, i]))
    }
    walk(n.content, [])
  }
  return out
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dayStart = (due: Due) => {
  const [y, m, d] = due.date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 先按时间（同一天里没写几点的排在最后），再按优先级从高到低 */
export function compareTodos(a: TodoRef, b: TodoRef): number {
  if (a.due && b.due) {
    const d = dueToDate(a.due).getTime() - dueToDate(b.due).getTime()
    if (d !== 0) return d
  } else if (a.due || b.due) {
    return a.due ? -1 : 1
  }
  return b.priority - a.priority
}

export interface TodoGroup {
  /** 分组的键：overdue、today、某一天（YYYY-MM-DD）、someday（没有日期）、done */
  key: string
  todos: TodoRef[]
}

/** 今天：逾期的 + 今天到期的，未完成 */
export function todayTodos(todos: TodoRef[], now: Date = new Date()): TodoGroup[] {
  const today = startOfDay(now).getTime()
  const overdue: TodoRef[] = []
  const due: TodoRef[] = []
  for (const t of todos) {
    if (t.checked || !t.due) continue
    const day = dayStart(t.due).getTime()
    if (day < today) overdue.push(t)
    else if (day === today) due.push(t)
  }
  return [
    { key: 'overdue', todos: overdue.sort(compareTodos) },
    { key: 'today', todos: due.sort(compareTodos) },
  ].filter((g) => g.todos.length > 0)
}

/** 即将：今天以后的按天分组，最后是没有日期的 */
export function upcomingTodos(todos: TodoRef[], now: Date = new Date()): TodoGroup[] {
  const today = startOfDay(now).getTime()
  const byDay = new Map<string, TodoRef[]>()
  const someday: TodoRef[] = []
  for (const t of todos) {
    if (t.checked) continue
    if (!t.due) {
      someday.push(t)
      continue
    }
    if (dayStart(t.due).getTime() <= today) continue
    const list = byDay.get(t.due.date) ?? []
    list.push(t)
    byDay.set(t.due.date, list)
  }
  const groups = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, list]) => ({ key, todos: list.sort(compareTodos) }))
  if (someday.length) groups.push({ key: 'someday', todos: someday.sort(compareTodos) })
  return groups
}

/** 已完成：最近编辑过的在前 */
export const doneTodos = (todos: TodoRef[]): TodoRef[] =>
  todos.filter((t) => t.checked).sort((a, b) => b.updatedAt - a.updatedAt)

/** 带某个标签的待办：未完成的在前 */
export function taggedTodos(todos: TodoRef[], tag: string): TodoGroup[] {
  const mine = todos.filter((t) => t.tags.includes(tag))
  return [
    { key: 'open', todos: mine.filter((t) => !t.checked).sort(compareTodos) },
    { key: 'done', todos: mine.filter((t) => t.checked).sort((a, b) => b.updatedAt - a.updatedAt) },
  ].filter((g) => g.todos.length > 0)
}

/** 所有标签及使用次数（未完成的待办），按次数从多到少 */
export function collectTags(todos: TodoRef[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of todos) {
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + (t.checked ? 0 : 1))
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'))
}

/** “今天”视图里的数量（侧边栏显示） */
export const todayCount = (todos: TodoRef[], now: Date = new Date()) =>
  todayTodos(todos, now).reduce((n, g) => n + g.todos.length, 0)
