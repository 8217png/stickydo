import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { collectTags, todayCount } from '@stickydo/core/capture'
import { NOTE_COLORS, noteColorVar } from '../design/colors'
import { type Board, noteBoardId, sortedBoards, useNotes } from '../features/notes/store'
import { createBoardAndOpen, deleteBoardWithUndo } from '../features/boards/actions'
import { useNow, useTodos } from '../features/todos/useTodos'
import { sameView, setView, toggleSidebar, useView, type View } from '../features/view'
import { isExtension } from '../extension/surface'
import { Logo } from './TopBar'

/**
 * 侧边栏（docs/frontend-design.md §4）：待办视图、收件箱、看板、标签。
 * 宽屏常驻（[ 收起），窄屏是从左侧滑出的抽屉。便利贴可以拖到看板上移过去。
 */
export function Sidebar() {
  const open = useView((s) => s.sidebarOpen)
  const narrow = useNarrow()

  if (!narrow) {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="h-full shrink-0 overflow-hidden"
            initial={{ width: 0 }}
            animate={{ width: 236 }}
            exit={{ width: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <SidebarPanel />
          </motion.div>
        )}
      </AnimatePresence>
    )
  }
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9500]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/15" onPointerDown={() => toggleSidebar(false)} />
          <motion.div
            className="absolute inset-y-0 left-0 shadow-chrome"
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            exit={{ x: -260, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 460, damping: 40 }}
          >
            <SidebarPanel />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function useNarrow() {
  const query = '(max-width: 899px)'
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function SidebarPanel() {
  const view = useView((s) => s.view)
  const notes = useNotes((s) => s.notes)
  const trashCount = useNotes((s) => s.trash.length)
  const boards = useNotes((s) => s.boards)
  const todos = useTodos()
  const now = useNow()
  const tags = useMemo(() => collectTags(todos), [todos])
  const counts = useMemo(() => {
    const ids = new Set(boards.map((b) => b.id))
    const m = new Map<string | null, number>()
    for (const n of notes) {
      const b = noteBoardId(n, ids)
      m.set(b, (m.get(b) ?? 0) + 1)
    }
    return m
  }, [notes, boards])
  const [adding, setAdding] = useState(false)
  const go = (v: View) => setView(v)
  const active = (v: View) => sameView(view, v)

  return (
    <nav
      aria-label="导航"
      className="flex h-full w-[236px] flex-col border-r border-chrome-border bg-surface"
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Logo />
        <span className={`text-[14px] font-semibold tracking-tight ${isExtension ? 'hidden' : ''}`}>Sticky-Do</span>
        <button
          type="button"
          title="收起侧边栏（[）"
          aria-label="收起侧边栏"
          className="ml-auto grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink"
          onClick={() => toggleSidebar(false)}
        >
          <SidebarIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <Section>
          <Item icon={<SunIcon />} label="今天" count={todayCount(todos, now)} active={active({ kind: 'today' })} onClick={() => go({ kind: 'today' })} />
          <Item icon={<CalendarIcon />} label="即将" active={active({ kind: 'upcoming' })} onClick={() => go({ kind: 'upcoming' })} />
          <Item icon={<CheckIcon />} label="已完成" active={active({ kind: 'done' })} onClick={() => go({ kind: 'done' })} />
        </Section>

        <Section>
          <Item
            icon={<InboxIcon />}
            label="收件箱"
            count={counts.get(null) ?? 0}
            muted
            active={active({ kind: 'board', boardId: null })}
            onClick={() => go({ kind: 'board', boardId: null })}
            dropBoard={null}
          />
        </Section>

        <Section
          title="看板"
          action={
            <button
              type="button"
              title="新建看板"
              aria-label="新建看板"
              className="grid size-6 place-items-center rounded-md text-ink-muted transition-colors hover:bg-chrome-hover hover:text-ink"
              onClick={() => setAdding(true)}
            >
              <PlusIcon />
            </button>
          }
        >
          <BoardList boards={boards} counts={counts} view={view} />
          {adding ? (
            <NameInput
              placeholder="看板名称"
              onDone={(name) => {
                setAdding(false)
                if (name) createBoardAndOpen(name)
              }}
            />
          ) : (
            boards.length === 0 && (
              <button
                type="button"
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-faint transition-colors hover:bg-chrome-hover hover:text-ink-muted"
                onClick={() => setAdding(true)}
              >
                + 新看板，例如“工作”“生活”
              </button>
            )
          )}
        </Section>

        <Section title="标签">
          {tags.length === 0 ? (
            <p className="px-2.5 py-1 text-[12.5px] leading-relaxed text-ink-faint">在待办里写 #标签 分类，例如 [] 买牛奶 #生活</p>
          ) : (
            tags.map(({ tag, count }) => (
              <Item
                key={tag}
                icon={<span className="w-4 text-center text-[14px] text-ink-faint">#</span>}
                label={tag}
                count={count}
                muted
                active={active({ kind: 'tag', tag })}
                onClick={() => go({ kind: 'tag', tag })}
              />
            ))
          )}
        </Section>

        <Section>
          <Item
            icon={<TrashIcon />}
            label="回收站"
            count={trashCount}
            muted
            active={active({ kind: 'trash' })}
            onClick={() => go({ kind: 'trash' })}
          />
        </Section>
      </div>
    </nav>
  )
}

function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      {title && (
        <div className="flex h-7 items-center justify-between px-2.5 text-[11.5px] font-medium tracking-wide text-ink-faint">
          {title}
          {action}
        </div>
      )}
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

function Item(props: {
  icon: ReactNode
  label: string
  count?: number
  /** 数字只是提示，不强调 */
  muted?: boolean
  active: boolean
  onClick: () => void
  /** 可以把便利贴拖到这里：值是看板 id，收件箱为 null */
  dropBoard?: string | null
  children?: ReactNode
}) {
  return (
    <div
      className="group relative"
      {...(props.dropBoard !== undefined ? { 'data-drop-board': props.dropBoard ?? '' } : {})}
    >
      <button
        type="button"
        aria-current={props.active ? 'page' : undefined}
        className={`sidebar-item flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] transition-colors ${
          props.active ? 'bg-chrome-hover font-medium text-ink' : 'text-ink-muted hover:bg-chrome-hover hover:text-ink'
        }`}
        onClick={props.onClick}
      >
        <span className="grid w-4 shrink-0 place-items-center">{props.icon}</span>
        <span className="min-w-0 flex-1 truncate">{props.label}</span>
        {props.count != null && props.count > 0 && (
          <span className={`text-[12px] tabular-nums group-hover:opacity-0 ${props.muted ? 'text-ink-faint' : 'font-medium text-ink'}`}>
            {props.count}
          </span>
        )}
      </button>
      {props.children}
    </div>
  )
}

/** 看板列表：可以上下拖动排序，松手时只给被移动的看板换排序键 */
function BoardList({ boards, counts, view }: { boards: Board[]; counts: Map<string | null, number>; view: View }) {
  const sorted = useMemo(() => sortedBoards(boards), [boards])
  const [order, setOrder] = useState(() => sorted.map((b) => b.id))
  const latest = useRef(order)
  const dragging = useRef(false)
  // 刚拖完时不当作点击
  const suppressClick = useRef(false)
  const key = sorted.map((b) => b.id).join()
  useEffect(() => {
    if (dragging.current) return
    const ids = key ? key.split(',') : []
    latest.current = ids
    setOrder(ids)
  }, [key])
  const byId = new Map(boards.map((b) => [b.id, b]))

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={order}
      onReorder={(ids: string[]) => {
        latest.current = ids
        setOrder(ids)
      }}
      className="flex flex-col gap-px"
    >
      {order.map((id, i) => {
        const b = byId.get(id)
        if (!b) return null
        return (
          <BoardItem
            key={id}
            board={b}
            index={i}
            total={order.length}
            count={counts.get(id) ?? 0}
            active={sameView(view, { kind: 'board', boardId: id })}
            suppressClick={suppressClick}
            onDragStart={() => {
              dragging.current = true
              suppressClick.current = true
            }}
            onDragEnd={() => {
              dragging.current = false
              useNotes.getState().moveBoard(id, latest.current.indexOf(id))
              setTimeout(() => (suppressClick.current = false), 0)
            }}
          />
        )
      })}
    </Reorder.Group>
  )
}

function BoardItem(props: {
  board: Board
  index: number
  total: number
  count: number
  active: boolean
  suppressClick: { current: boolean }
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const { board, count, active } = props
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  if (renaming) {
    return (
      <NameInput
        initial={board.name}
        placeholder="看板名称"
        onDone={(name) => {
          setRenaming(false)
          if (name && name !== board.name) useNotes.getState().updateBoard(board.id, { name })
        }}
      />
    )
  }
  return (
    <Reorder.Item
      as="div"
      value={board.id}
      dragListener={!menu}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      className="relative rounded-lg"
      whileDrag={{ scale: 1.02, zIndex: 5, boxShadow: 'var(--shadow-chrome)', backgroundColor: 'var(--surface)' }}
      data-board-item={board.name}
    >
      <Item
        icon={<span className="size-2.5 rounded-full border border-black/10" style={{ background: noteColorVar(board.color) }} />}
        label={board.name}
        count={count}
        muted
        active={active}
        onClick={() => {
          if (!props.suppressClick.current) setView({ kind: 'board', boardId: board.id })
        }}
        dropBoard={board.id}
      >
        <button
          type="button"
          title="更多"
          aria-label={`「${board.name}」的更多操作`}
          className="absolute top-1 right-1 grid size-6 place-items-center rounded-md text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-chrome-hover hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" />
          </svg>
        </button>
        {menu && (
          <BoardMenu
            board={board}
            index={props.index}
            total={props.total}
            onClose={() => setMenu(false)}
            onRename={() => {
              setMenu(false)
              setRenaming(true)
            }}
          />
        )}
      </Item>
    </Reorder.Item>
  )
}

function BoardMenu(props: { board: Board; index: number; total: number; onClose: () => void; onRename: () => void }) {
  const { board, onClose, onRename } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      className="absolute top-8 right-0 z-10 w-[188px] rounded-ui border border-chrome-border bg-surface p-1 shadow-chrome"
    >
      <MenuItem onClick={onRename}>重命名</MenuItem>
      {/* 键盘也能排序（拖动的替代） */}
      {props.index > 0 && <MenuItem onClick={() => useNotes.getState().moveBoard(board.id, props.index - 1)}>上移</MenuItem>}
      {props.index < props.total - 1 && <MenuItem onClick={() => useNotes.getState().moveBoard(board.id, props.index + 1)}>下移</MenuItem>}
      <div className="flex flex-wrap gap-1 px-2 py-1.5" role="group" aria-label="颜色">
        {NOTE_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.name}
            aria-label={c.name}
            className="grid size-5 place-items-center rounded-full transition-transform hover:scale-110"
            onClick={() => useNotes.getState().updateBoard(board.id, { color: c.key })}
          >
            <span
              className="size-3.5 rounded-full border border-black/10"
              style={{
                background: noteColorVar(c.key),
                boxShadow: board.color === c.key ? '0 0 0 2px var(--surface), 0 0 0 3.5px var(--ink-muted)' : undefined,
              }}
            />
          </button>
        ))}
      </div>
      <MenuItem
        danger
        onClick={() => {
          onClose()
          deleteBoardWithUndo(board.id)
        }}
      >
        删除看板
      </MenuItem>
    </div>
  )
}

function MenuItem({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-chrome-hover ${danger ? 'text-danger' : 'text-ink'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 新建或重命名看板的输入框：回车确定，Esc 或点到别处取消（点到别处时有内容就保存） */
function NameInput({ initial = '', placeholder, onDone }: { initial?: string; placeholder: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (name: string) => {
    if (done.current) return
    done.current = true
    onDone(Array.from(name.trim()).slice(0, 60).join(''))
  }
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={60}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(initial)
        }
      }}
      className="h-8 w-full rounded-lg border border-field-border bg-field px-2.5 text-[13.5px] text-ink outline-none focus:border-focus"
    />
  )
}

// ---------- 图标 ----------

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
export const SidebarIcon = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </Svg>
)
const SunIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </Svg>
)
const CalendarIcon = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="11" rx="2" />
    <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
  </Svg>
)
const CheckIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.5 8.2l1.7 1.7 3.3-3.6" />
  </Svg>
)
const InboxIcon = () => (
  <Svg>
    <path d="M2 9.5l1.6-5.2A1 1 0 014.6 3.5h6.8a1 1 0 011 .8L14 9.5V12a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12z" />
    <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
  </Svg>
)
const TrashIcon = () => (
  <Svg>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
)
const PlusIcon = () => (
  <Svg>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
)
