import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import {
  doneTodos,
  dueStatus,
  formatDue,
  PRIORITY_LABEL,
  taggedTodos,
  type TodoGroup,
  type TodoRef,
  todayTodos,
  upcomingTodos,
} from '@stickydo/core/capture'
import { noteColorVar } from '../../design/colors'
import { type Note, noteBoardId, noteTitle, useNotes } from '../notes/store'
import { toggleTaskAt } from '../notes/NoteRenderer'
import { openNote } from '../boards/actions'
import { MORPH_LIMIT, type View } from '../view'
import { useNow, useTodos } from './useTodos'

type TodoView = Exclude<View, { kind: 'board' } | { kind: 'trash' }>

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const fullDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY[d.getDay()]}`
const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const keyOf = (t: TodoRef) => `${t.noteId}:${t.path.join('.')}`

/** 勾选后先显示划线，稍等再从列表里收起（docs/frontend-design.md §3.3） */
const SETTLE_MS = 650

/**
 * 待办视图（今天 / 即将 / 已完成 / 某个标签）：从所有便利贴里汇总待办项。
 * 勾选直接改便利贴里的待办项，可撤销；点一条待办跳到它所在的便利贴。
 */
export function TodoView({ view }: { view: TodoView }) {
  const todos = useTodos()
  const now = useNow()
  const groups = useMemo<TodoGroup[]>(() => {
    switch (view.kind) {
      case 'today':
        return todayTodos(todos, now)
      case 'upcoming':
        return upcomingTodos(todos, now)
      case 'done': {
        const done = doneTodos(todos)
        return done.length ? [{ key: 'done-list', todos: done }] : []
      }
      case 'tag':
        return taggedTodos(todos, view.tag)
    }
  }, [view, todos, now])

  // 正在“收起”的待办：已经显示为切换后的状态，稍后才真正写入
  const [settling, setSettling] = useState<Set<string>>(() => new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const toggle = (t: TodoRef) => {
    const key = keyOf(t)
    if (timers.current.has(key)) return
    setSettling((s) => new Set(s).add(key))
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        commitToggle(t)
        setSettling((s) => {
          const next = new Set(s)
          next.delete(key)
          return next
        })
      }, SETTLE_MS),
    )
  }

  const title = { today: '今天', upcoming: '即将', done: '已完成', tag: view.kind === 'tag' ? `#${view.tag}` : '' }[view.kind]
  const count = groups.reduce((n, g) => n + g.todos.length, 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-5 pt-20 pb-24 sm:px-8">
        <header className="mb-5">
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {view.kind === 'today' ? fullDate(now) : view.kind === 'done' ? '最近完成的在前' : `${count} 项`}
          </p>
        </header>

        {view.kind !== 'done' && <AddTodo view={view} />}

        {groups.length === 0 ? (
          <EmptyTodos view={view} />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mt-6 first:mt-0">
              <GroupHeading group={g} now={now} />
              <ul>
                <AnimatePresence initial={false}>
                  {g.todos.map((t) => {
                    const key = keyOf(t)
                    const shownChecked = settling.has(key) ? !t.checked : t.checked
                    return <TodoRow key={key} todo={t} checked={shownChecked} now={now} onToggle={() => toggle(t)} animateLayout={count <= MORPH_LIMIT} />
                  })}
                </AnimatePresence>
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

/** 真正勾选 / 取消：改便利贴正文里的那一项，算一步撤销 */
function commitToggle(t: TodoRef) {
  const s = useNotes.getState()
  const note = s.notes.find((n) => n.id === t.noteId)
  if (!note) return
  s.update(note.id, { content: toggleTaskAt(note.content, t.path) })
  const label = Array.from(t.text || '待办')
  const short = label.length > 16 ? `${label.slice(0, 16).join('')}…` : label.join('')
  toast(t.checked ? `已恢复「${short}」` : `已完成「${short}」`, {
    id: `todo-${keyOf(t)}`,
    action: {
      label: '撤销',
      onClick: () => {
        const cur = useNotes.getState().notes.find((n) => n.id === t.noteId)
        if (cur) useNotes.getState().update(cur.id, { content: toggleTaskAt(cur.content, t.path) })
      },
    },
  })
}

function GroupHeading({ group, now }: { group: TodoGroup; now: Date }) {
  let label: string
  let tone = 'text-ink-muted'
  switch (group.key) {
    case 'overdue':
      label = '已逾期'
      tone = 'text-[var(--overdue)]'
      break
    case 'today':
      label = '今天'
      break
    case 'someday':
      label = '没有日期'
      break
    case 'open':
      label = '未完成'
      break
    case 'done':
      label = '已完成'
      break
    case 'done-list':
      return null
    default: {
      const day = parseDay(group.key)
      const rel = formatDue({ date: group.key }, now)
      // 明天、后天加上具体日期；其余直接写日期和星期
      label = rel === '明天' || rel === '后天' ? `${rel} · ${fullDate(day)}` : fullDate(day)
    }
  }
  return (
    <h2 className={`mb-1 flex items-baseline gap-2 border-b border-chrome-border pb-1.5 text-[12.5px] font-medium ${tone}`}>
      {label}
      <span className="font-normal text-ink-faint tabular-nums">{group.todos.length}</span>
    </h2>
  )
}

function TodoRow(props: { todo: TodoRef; checked: boolean; now: Date; onToggle: () => void; animateLayout: boolean }) {
  const { todo, checked, now, onToggle } = props
  const note = useNotes((s) => s.notes.find((n) => n.id === todo.noteId))
  const boards = useNotes((s) => s.boards)
  const board = useMemo(() => {
    if (!note) return null
    const id = noteBoardId(note, new Set(boards.map((b) => b.id)))
    return id ? boards.find((b) => b.id === id) ?? null : null
  }, [note, boards])
  const status = todo.due && dueStatus(todo.due, now)

  return (
    <motion.li
      // 收起一条时其他的平滑上移；条目很多时关掉（每次渲染都要测量位置）
      layout={props.animateLayout ? 'position' : false}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
      data-todo={todo.text}
      data-checked={checked}
    >
      <div
        role="button"
        tabIndex={0}
        className="todo-row group flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-chrome-hover"
        onClick={() => openNote(todo.noteId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openNote(todo.noteId)
        }}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={checked ? '标记为未完成' : '标记为完成'}
          className="note-md-check mt-[3px] shrink-0"
          data-checked={checked}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M2 5.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className={`todo-text text-[14.5px] leading-snug transition-colors ${checked ? 'text-ink-faint line-through' : 'text-ink'}`}>
            {todo.text || <span className="text-ink-faint">（空白待办）</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
            {todo.due && (
              <span className="todo-chip" data-status={status}>
                {formatDue(todo.due, now)}
              </span>
            )}
            {todo.priority > 0 && (
              <span className="todo-chip" data-priority={todo.priority}>
                !{PRIORITY_LABEL[todo.priority]}
              </span>
            )}
            {todo.tags.map((tag) => (
              <span key={tag} className="todo-chip todo-tag">
                #{tag}
              </span>
            ))}
            {note && (
              <span className="flex min-w-0 items-center gap-1.5 text-ink-faint">
                <span className="size-2 shrink-0 rounded-[2px] border border-black/10" style={{ background: noteColorVar(note.color) }} />
                <span className="truncate">{noteContext(note, board?.name, todo.text)}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.li>
  )
}

/** 待办所在的位置：看板名，便利贴标题和待办本身不同时再加上标题 */
function noteContext(note: Note, boardName: string | undefined, text: string) {
  const title = noteTitle(note)
  const where = boardName ?? '收件箱'
  return text.startsWith(title.replace(/…$/, '')) ? where : `${where} · ${title}`
}

/** 列表顶部的输入框：在“今天”里记的没写时间就算今天，在标签里记的自动带上这个标签 */
function AddTodo({ view }: { view: TodoView }) {
  const [text, setText] = useState('')
  const submit = async () => {
    const body = text.trim().replace(/^(?:-\s*)?\[\s?\]\s*/, '')
    if (!body) return
    // 解析器（chrono-node）按需加载
    const [{ parseCapture }, { createFromCapture }] = await Promise.all([
      import('@stickydo/core/capture/parse'),
      import('../capture/actions'),
    ])
    let input = `[] ${body}`
    const c = parseCapture(input)
    if (view.kind === 'today' && !c.due) input += ' 今天'
    if (view.kind === 'tag' && !c.tags.includes(view.tag)) input += ` #${view.tag}`
    if (createFromCapture(input, { reveal: false })) setText('')
  }
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 transition-colors focus-within:border-chrome-border focus-within:bg-surface">
      <span className="grid size-4 shrink-0 place-items-center text-ink-faint">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setText('')
            e.currentTarget.blur()
          }
        }}
        placeholder={
          view.kind === 'today' ? '添加今天的待办，例如：交周报 下午3点 !高' : view.kind === 'tag' ? `添加带 #${view.tag} 的待办` : '添加待办，例如：买牛奶 明天 #生活'
        }
        aria-label="添加待办"
        className="h-8 min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

function EmptyTodos({ view }: { view: TodoView }) {
  const copy = {
    today: ['今天没有待办', '好好休息，或者在上面记一条'],
    upcoming: ['接下来没有安排', '记待办时写上时间，例如“明天下午3点”“周五”'],
    done: ['还没有完成的待办', '勾掉一条待办，它就会出现在这里'],
    tag: ['这个标签下没有待办', '在待办里写上标签就会出现在这里'],
  }[view.kind]
  return (
    <motion.div
      className="mt-16 flex flex-col items-center gap-4 text-center"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { delay: 0.1, duration: 0.3 } }}
    >
      <svg width="96" height="80" viewBox="0 0 96 80" fill="none" aria-hidden>
        <rect x="16" y="10" width="56" height="56" rx="3" transform="rotate(-4 16 10)" fill="var(--note-mint)" />
        <path d="M30 34l7 7 15-16" stroke="var(--note-ink-muted)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-4 16 10)" />
        <path d="M78 14l3 5M86 24l-5 2M82 16l-3 3" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div>
        <p className="text-[15px] font-medium text-ink">{copy[0]}</p>
        <p className="mt-1.5 text-[13px] text-ink-muted">{copy[1]}</p>
      </div>
    </motion.div>
  )
}
