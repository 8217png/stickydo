import { describe, expect, it } from 'vitest'
import type { NoteDoc } from '../notes/doc'
import { collectTags, collectTodos, doneTodos, taggedTodos, todayCount, todayTodos, upcomingTodos } from './todos'

// 2026-10-02（周五）10:00
const NOW = new Date(2026, 9, 2, 10, 0)

const item = (text: string, attrs: Record<string, unknown> = {}, nested?: NoteDoc['content']) => ({
  type: 'taskItem',
  attrs: { checked: false, ...attrs },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...(nested ?? [])],
})
const doc = (...content: NonNullable<NoteDoc['content']>) => ({ type: 'doc', content }) as NoteDoc
const list = (...items: NonNullable<NoteDoc['content']>) => ({ type: 'taskList', content: items })

const notes = [
  {
    id: 'a',
    updatedAt: 100,
    content: doc(
      { type: 'paragraph', content: [{ type: 'text', text: '标题' }] },
      list(
        item('逾期', { due: '2026-09-30', priority: 1 }),
        item('今天下午', { due: '2026-10-02T15:00', tags: ['工作'] }),
        item('父任务', {}, [list(item('子任务', { due: '2026-10-05', tags: ['工作'] }))]),
      ),
    ),
  },
  {
    id: 'b',
    updatedAt: 200,
    content: doc(
      list(
        item('今天高优先级', { due: '2026-10-02', priority: 3 }),
        item('明天', { due: '2026-10-03' }),
        item('做完了', { checked: true, due: '2026-10-01', tags: ['工作', '生活'] }),
      ),
    ),
  },
]

describe('collectTodos', () => {
  const todos = collectTodos(notes)

  it('收集所有待办项，包括嵌套的；文字不含子列表', () => {
    expect(todos.map((t) => t.text)).toEqual(['逾期', '今天下午', '父任务', '子任务', '今天高优先级', '明天', '做完了'])
    const child = todos.find((t) => t.text === '子任务')!
    expect(child.path).toEqual([1, 2, 1, 0])
    expect(child.due).toEqual({ date: '2026-10-05' })
  })

  it('今天：逾期的一组，今天的一组；同一天里有时间的在前、高优先级在前', () => {
    const groups = todayTodos(todos, NOW)
    expect(groups.map((g) => [g.key, g.todos.map((t) => t.text)])).toEqual([
      ['overdue', ['逾期']],
      ['today', ['今天下午', '今天高优先级']],
    ])
    expect(todayCount(todos, NOW)).toBe(3)
  })

  it('即将：按天分组，没有日期的放最后', () => {
    expect(upcomingTodos(todos, NOW).map((g) => [g.key, g.todos.map((t) => t.text)])).toEqual([
      ['2026-10-03', ['明天']],
      ['2026-10-05', ['子任务']],
      ['someday', ['父任务']],
    ])
  })

  it('已完成与标签', () => {
    expect(doneTodos(todos).map((t) => t.text)).toEqual(['做完了'])
    expect(taggedTodos(todos, '工作').map((g) => [g.key, g.todos.map((t) => t.text)])).toEqual([
      ['open', ['今天下午', '子任务']],
      ['done', ['做完了']],
    ])
    // 标签按未完成的数量排序；只出现在已完成待办里的标签数量为 0
    expect(collectTags(todos)).toEqual([
      { tag: '工作', count: 2 },
      { tag: '生活', count: 0 },
    ])
  })
})
