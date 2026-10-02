import { useMemo, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseCapture } from '@stickydo/core/capture/parse'
import { docText } from '../notes/doc'
import { NOTE_SIZES, noteBoardId, noteTitle, sortedBoards, useNotes } from '../notes/store'
import { collectTags, collectTodos } from '@stickydo/core/capture'
import { noteColorVar } from '../../design/colors'
import { boardName, createBoardAndOpen, moveNoteWithUndo, openNote } from '../boards/actions'
import { setBoardLayout, setView, toggleSidebar, useBoardLayout, useView } from '../view'
import { applyNoteSize } from '../notes/actions'
import { nextNotePosition } from '../notes/viewport'
import { useSettings } from '../settings'
import { useSession } from '../auth/session'
import { syncNow } from '../../sync/engine'
import { openStandaloneWindow } from '../../extension/standaloneWindow'
import { surface } from '../../extension/surface'
import { createFromCapture } from './actions'
import { closePalette, openCapture, useCommandUI } from './state'

/**
 * 命令面板（Ctrl/⌘+K）：搜索便利贴并跳转、执行任何操作。
 * 输入的文字不匹配任何命令或便利贴时，回车按快速记录保存（docs/frontend-design.md §2.1）。
 */
export function CommandPalette({ onHelp }: { onHelp: () => void }) {
  const open = useCommandUI((s) => s.paletteOpen)
  return <AnimatePresence>{open && <Palette onHelp={onHelp} />}</AnimatePresence>
}

/** 先关掉面板再执行，焦点回到白板 */
const run = (fn: () => void) => () => {
  closePalette()
  fn()
}

function Palette({ onHelp }: { onHelp: () => void }) {
  const present = useIsPresent()
  const [search, setSearch] = useState('')
  const notes = useNotes((s) => s.notes)
  const boards = useNotes((s) => s.boards)
  const selectedId = useNotes((s) => s.selectedId)
  const view = useView((s) => s.view)
  const onBoard = view.kind === 'board'
  const layout = useBoardLayout((s) => s.layout)
  const { undo, redo, create, setEditing } = useNotes.getState()
  const { setTheme, setTilt, tilt } = useSettings()
  const query = search.trim()

  // 搜索所有看板里的便利贴，显示所在看板
  const noteItems = useMemo(() => {
    if (!query) return []
    const ids = new Set(boards.map((b) => b.id))
    return notes.map((n) => {
      const text = docText(n.content).replace(/\s+/g, ' ').trim()
      const board = noteBoardId(n, ids)
      return { id: n.id, text: text || '空白便利贴', color: n.color, board: board ? boardName(board) : '收件箱' }
    })
  }, [notes, boards, query])
  const tags = useMemo(() => (query ? collectTags(collectTodos(notes)) : []), [notes, query])
  const sorted = useMemo(() => sortedBoards(boards), [boards])
  const selected = onBoard && selectedId ? notes.find((n) => n.id === selectedId) : undefined
  const selectedBoard = selected ? noteBoardId(selected, new Set(boards.map((b) => b.id))) : null
  const capture = query ? parseCapture(search) : null

  return (
    <motion.div
      // 退出动画期间不再接收焦点和按键，免得吞掉紧接着按下的快捷键
      inert={!present}
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/15 px-4 pt-[14vh] backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onPointerDown={closePalette}
    >
      <motion.div
        className="w-full max-w-[560px]"
        initial={{ y: -8, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: -4, scale: 0.99, transition: { duration: 0.1 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Command
          label="命令面板"
          loop
          className="cmdk overflow-hidden rounded-2xl border border-chrome-border bg-surface shadow-chrome"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            const toggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
            if (e.key === 'Escape' || toggle) {
              e.preventDefault()
              e.stopPropagation()
              closePalette()
            }
          }}
        >
          <div className="flex items-center gap-2.5 border-b border-chrome-border px-4">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-ink-faint" aria-hidden>
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="搜索便利贴、执行命令，或直接记一条…"
              className="h-13 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
            />
            <kbd className="flex-none">Esc</kbd>
          </div>

          <Command.List className="max-h-[min(400px,60vh)] overflow-y-auto overscroll-contain p-1.5">
            {noteItems.length > 0 && (
              <Command.Group heading="便利贴">
                {noteItems.map((n) => (
                  <Item
                    key={n.id}
                    value={`note ${n.id} ${n.text}`}
                    keywords={[n.board]}
                    onSelect={run(() => openNote(n.id))}
                    icon={<span className="size-3 rounded-[3px] border border-black/10" style={{ background: noteColorVar(n.color) }} />}
                  >
                    <span className="min-w-0 flex-1 truncate">{n.text}</span>
                    <span className="ml-2 flex-none text-[12px] text-ink-faint">{n.board}</span>
                  </Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="记录">
              <Item value="快速记录 quick capture" keywords={['记录', 'jl']} onSelect={run(() => openCapture())} shortcut="Q" icon={<PlusIcon />}>
                快速记录
              </Item>
              <Item value="新建待办 todo" keywords={['待办', 'todo']} onSelect={run(() => openCapture('[] '))} shortcut="T" icon={<CheckIcon />}>
                新建待办
              </Item>
              <Item
                value="新建便利贴 new note"
                keywords={['新建']}
                onSelect={run(() => {
                  const id = create(nextNotePosition({ preferCenter: true }))
                  setEditing(id)
                })}
                shortcut="N"
                icon={<NoteIcon />}
              >
                新建便利贴
              </Item>
            </Command.Group>

            {selected && (
              <Command.Group heading={`选中的「${noteTitle(selected)}」`}>
                {[null, ...sorted.map((b) => b.id)]
                  .filter((id) => id !== selectedBoard)
                  .map((id) => (
                    <Item key={id ?? 'inbox'} value={`移到 ${boardName(id)} move`} keywords={['移动', 'yd']} onSelect={run(() => moveNoteWithUndo(selected.id, id))} icon={<MoveIcon />}>
                      移到「{boardName(id)}」
                    </Item>
                  ))}
              </Command.Group>
            )}

            <Command.Group heading="前往">
              <Item value="今天 today" keywords={['jt']} onSelect={run(() => setView({ kind: 'today' }))} icon={<SunIcon />}>
                今天
              </Item>
              <Item value="即将 upcoming" keywords={['jj']} onSelect={run(() => setView({ kind: 'upcoming' }))} icon={<CalendarIcon />}>
                即将
              </Item>
              <Item value="已完成 done" keywords={['ywc']} onSelect={run(() => setView({ kind: 'done' }))} icon={<CheckIcon />}>
                已完成
              </Item>
              <Item value="收件箱 inbox" keywords={['sjx']} onSelect={run(() => setView({ kind: 'board', boardId: null }))} icon={<InboxIcon />}>
                收件箱
              </Item>
              <Item value="回收站 trash 恢复 删除" keywords={['hsz']} onSelect={run(() => setView({ kind: 'trash' }))} icon={<TrashIcon />}>
                回收站
              </Item>
              {sorted.map((b) => (
                <Item
                  key={b.id}
                  value={`看板 ${b.name} board ${b.id}`}
                  onSelect={run(() => setView({ kind: 'board', boardId: b.id }))}
                  icon={<span className="size-2.5 rounded-full border border-black/10" style={{ background: noteColorVar(b.color) }} />}
                >
                  {b.name}
                </Item>
              ))}
              {tags.map(({ tag }) => (
                <Item key={tag} value={`标签 #${tag} tag`} onSelect={run(() => setView({ kind: 'tag', tag }))} icon={<span className="w-4 text-center text-ink-faint">#</span>}>
                  {tag}
                </Item>
              ))}
              <Item value="侧边栏 sidebar 专注模式" onSelect={run(() => toggleSidebar())} shortcut="[" icon={<PanelIcon />}>
                收起 / 展开侧边栏
              </Item>
            </Command.Group>

            {onBoard && (
            <Command.Group heading="白板">
              {layout === 'board' ? (
                <Item value="列表视图 list view 切换" onSelect={run(() => setBoardLayout('list'))} shortcut="V" icon={<ListIcon />}>
                  切换为列表视图
                </Item>
              ) : (
                <Item value="白板视图 board view 切换" onSelect={run(() => setBoardLayout('board'))} shortcut="V" icon={<GridIcon />}>
                  切换为白板视图
                </Item>
              )}
              {layout === 'board' && NOTE_SIZES.map((s) => (
                <Item key={s.key} value={`统一大小 ${s.label} 自动排列 size ${s.key}`} onSelect={run(() => applyNoteSize(s.key))} shortcut={s.key === 's' ? '-' : s.key === 'l' ? '=' : undefined} icon={<GridIcon />}>
                  全部统一为「{s.label}」并自动排列
                </Item>
              ))}
            </Command.Group>
            )}

            <Command.Group heading="编辑">
              <Item value="撤销 undo" onSelect={run(undo)} shortcut="Ctrl Z" icon={<UndoIcon />}>
                撤销
              </Item>
              <Item value="重做 redo" onSelect={run(redo)} shortcut="Ctrl Shift Z" icon={<UndoIcon flip />}>
                重做
              </Item>
            </Command.Group>

            <Command.Group heading="外观">
              <Item value="主题 浅色 light theme" onSelect={run(() => setTheme('light'))} icon={<SunIcon />}>
                主题：浅色
              </Item>
              <Item value="主题 暗色 深色 dark theme" onSelect={run(() => setTheme('dark'))} icon={<MoonIcon />}>
                主题：暗色
              </Item>
              <Item value="主题 跟随系统 system theme" onSelect={run(() => setTheme('system'))} icon={<HalfIcon />}>
                主题：跟随系统
              </Item>
              <Item value={`便利贴倾斜 tilt ${tilt ? '关闭' : '打开'}`} onSelect={run(() => setTilt(!tilt))} icon={<TiltIcon />}>
                {tilt ? '关闭便利贴倾斜' : '打开便利贴倾斜'}
              </Item>
            </Command.Group>

            <Command.Group heading="其他">
              <Item value="快捷键 速查 help shortcuts" onSelect={run(onHelp)} shortcut="?" icon={<KeyIcon />}>
                快捷键速查
              </Item>
              <AccountCommands />
              {surface === 'ext-popup' && (
                <Item value="在独立窗口打开 window" onSelect={run(() => void openStandaloneWindow())} icon={<WindowIcon />}>
                  在独立窗口打开
                </Item>
              )}
            </Command.Group>

            {/* 不匹配任何命令时，它是唯一一项：回车即记录 */}
            {capture && (
              <Command.Group heading="记一条" forceMount>
                <Item
                  value="__capture__"
                  forceMount
                  onSelect={run(() => createFromCapture(search))}
                  icon={capture.kind === 'todo' ? <CheckIcon /> : <PlusIcon />}
                >
                  <span className="truncate">
                    {capture.kind === 'todo' ? '记录待办：' : '记录为便利贴：'}
                    <span className="text-ink-muted">{capture.kind === 'todo' ? capture.title : query}</span>
                  </span>
                </Item>
                {capture.kind === 'note' && Array.from(query).length <= 60 && (
                  <Item value="__new_board__" forceMount onSelect={run(() => createBoardAndOpen(query))} icon={<PlusIcon />}>
                    <span className="truncate">
                      新建看板「<span className="text-ink-muted">{query}</span>」
                    </span>
                  </Item>
                )}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </motion.div>
    </motion.div>
  )
}

/** 只在 Web 版：账号与同步（需要路由） */
function AccountCommands() {
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  if (!user) {
    return (
      <Item
        value="登录 注册 账号 login"
        // 插件浮窗里到独立窗口登录（见 AccountMenu）
        onSelect={run(() => (surface === 'ext-popup' ? void openStandaloneWindow('/login') : navigate('/login')))}
        icon={<UserIcon />}
      >
        登录 / 注册
      </Item>
    )
  }
  return (
    <>
      <Item value="立即同步 sync" onSelect={run(() => void syncNow())} icon={<SyncIcon />}>
        立即同步
      </Item>
      <Item value="账号与设备 修改密码 account password devices" onSelect={run(() => navigate('/account'))} icon={<UserIcon />}>
        账号与设备
      </Item>
      <Item
        value="退出登录 logout"
        onSelect={run(async () => {
          await useSession.getState().logout()
          toast('已退出登录')
        })}
        icon={<UserIcon />}
      >
        退出登录
      </Item>
    </>
  )
}

function Item(props: {
  value: string
  keywords?: string[]
  onSelect: () => void
  shortcut?: string
  icon?: ReactNode
  forceMount?: boolean
  children: ReactNode
}) {
  return (
    <Command.Item
      value={props.value}
      keywords={props.keywords}
      forceMount={props.forceMount}
      onSelect={props.onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[14px] text-ink select-none data-[selected=true]:bg-chrome-hover"
    >
      <span className="grid size-4 flex-none place-items-center text-ink-muted">{props.icon}</span>
      <span className="flex min-w-0 flex-1 items-center">{props.children}</span>
      {props.shortcut && (
        <span className="flex flex-none gap-1">
          {props.shortcut.split(' ').map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      )}
    </Command.Item>
  )
}

// ---------- 图标 ----------

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
const PlusIcon = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>
const NoteIcon = () => <Svg><path d="M3 2.5h10v7l-3.5 4H3z" /><path d="M9.5 13.5v-4H13" /></Svg>
const CheckIcon = () => <Svg><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M5.5 8.2l1.8 1.8 3.4-3.8" /></Svg>
const GridIcon = () => <Svg><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></Svg>
const UndoIcon = ({ flip }: { flip?: boolean }) => (
  <Svg>
    <g transform={flip ? 'matrix(-1 0 0 1 16 0)' : undefined}>
      <path d="M5.5 4L3 6.5 5.5 9M3.5 6.5h6a3.5 3.5 0 010 7H8" />
    </g>
  </Svg>
)
const SunIcon = () => <Svg><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></Svg>
const MoonIcon = () => <Svg><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" /></Svg>
const HalfIcon = () => <Svg><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 000-11z" fill="currentColor" /></Svg>
const TiltIcon = () => <Svg><rect x="4" y="4" width="8" height="8" rx="1" transform="rotate(-8 8 8)" /></Svg>
const KeyIcon = () => <Svg><rect x="1.5" y="4" width="13" height="8.5" rx="1.5" /><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 10h6" /></Svg>
const UserIcon = () => <Svg><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" /></Svg>
const SyncIcon = () => <Svg><path d="M13 5.5A5.5 5.5 0 003.3 4.5M3 10.5a5.5 5.5 0 009.7 1M13 2.5v3h-3M3 13.5v-3h3" /></Svg>
const WindowIcon = () => <Svg><path d="M9.5 2.5h4v4M13.5 2.5L8 8M11.5 9.5v3a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1h3" /></Svg>
const CalendarIcon = () => <Svg><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></Svg>
const InboxIcon = () => <Svg><path d="M2 9.5l1.6-5.2A1 1 0 014.6 3.5h6.8a1 1 0 011 .8L14 9.5V12a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12z" /><path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" /></Svg>
const PanelIcon = () => <Svg><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M6 3v10" /></Svg>
const MoveIcon = () => <Svg><path d="M2.5 8h9M9 5l3 3-3 3" /><path d="M13.5 3v10" /></Svg>
const ListIcon = () => <Svg><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" /></Svg>
const TrashIcon = () => <Svg><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>
