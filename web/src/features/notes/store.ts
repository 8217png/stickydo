import { toast } from 'sonner'
import { create } from 'zustand'
import { uuidv7 } from '../../lib/id'
import { load, save } from '../../lib/storage'
import { type NoteSizeKey, useSettings } from '../settings'
import { currentPopupSize } from '../../extension/popupSize'
import { surface } from '../../extension/surface'
import { createSaveQueue, emptyPersisted, type NotesRepo, type Persisted, TRASH_RETENTION_MS, type TrashItem } from '@stickydo/core/storage'
import {
  type Board,
  commitBoards,
  commitLocal,
  isSortKey,
  keyBetween,
  type Note,
  patchStep,
  type RemoteChanges,
  type Snapshot,
  type SyncData,
} from '@stickydo/core/sync'
import type { NoteColor } from '@stickydo/core/design'
import { activeBoardId } from '../view'
import { migrateFromLocalStorage, openNotesRepo } from '../../storage/notesRepo'
import { docFromText, docIsEmpty, docTitle, emptyDoc, isNoteDoc, loadMarkdown, type NoteDoc } from './doc'
import { gridLayout } from './layout'

export type { Board, Note, Snapshot }

export const NOTE_SIZES = [
  { key: 's', label: '小', w: 160, h: 140 },
  { key: 'm', label: '中', w: 220, h: 200 },
  { key: 'l', label: '大', w: 300, h: 280 },
] as const satisfies readonly { key: NoteSizeKey; label: string; w: number; h: number }[]
export type NoteSize = (typeof NOTE_SIZES)[number]

export const sizeOf = (key: NoteSizeKey): NoteSize => NOTE_SIZES.find((p) => p.key === key) ?? NOTE_SIZES[1]
/** 当前全局档位的尺寸，新建便利贴使用 */
export const currentNoteSize = () => {
  const { w, h } = sizeOf(useSettings.getState().noteSize)
  return { w, h }
}
const HISTORY_LIMIT = 20

/** 便利贴的倾斜角度（±1.5°）：由 id 算出，每台设备一致，不需要同步 */
export function noteTilt(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return Math.round((((h >>> 0) % 1000) / 1000) * 30 - 15) / 10
}

/** 把 Markdown 文本转成正文（按需加载，见 doc.ts 的 loadMarkdown） */
type MarkdownConverter = (md: string) => NoteDoc

async function sampleNotes(): Promise<Note[]> {
  const now = Date.now()
  const markdownToDoc = await loadMarkdown()
  const notes: Note[] = baseSampleNotes().map((n) => ({
    ...n,
    content: markdownToDoc(n.content),
    version: 0,
    updatedAt: now,
    dirty: true,
    sample: true,
  }))
  // 窄屏（插件浮窗、手机）上，示例便利贴按网格排好，不要跑出可见范围
  const width = surface === 'ext-popup' ? currentPopupSize().w : window.innerWidth
  if (width >= 760) return notes
  const pos = gridLayout(notes, NOTE_SIZES[1], width)
  return notes.map((n) => ({ ...n, ...pos.get(n.id) }))
}

function baseSampleNotes() {
  const base = { w: 220, h: 200 }
  return [
    {
      ...base,
      id: uuidv7(),
      content:
        surface === 'ext-popup'
          ? '欢迎来到 Sticky-Do 👋\n双击空白处，就能贴上一张新便利贴。拖左下角可以调整浮窗大小，右上角可以在独立窗口打开。'
          : '欢迎来到 Sticky-Do 👋\n双击空白处，就能贴上一张新便利贴。',
      color: 'lemon' as const,
      x: 120,
      y: 110,
      z: 1,
    },
    {
      ...base,
      id: uuidv7(),
      content: '拖我试试\n按住拖动，拖到哪里放到哪里。拖右下角可以单独调整这一张的大小。',
      color: 'sky' as const,
      x: 400,
      y: 150,
      z: 2,
    },
    {
      ...base,
      id: uuidv7(),
      content: '整理一下\n右上角的“小 中 大”会统一所有便利贴的大小并自动排整齐（快捷键 - / =）。选中后按 1–8 换色，Delete 删除，Ctrl+Z 撤销。',
      color: 'blossom' as const,
      x: 260,
      y: 400,
      z: 3,
    },
    {
      ...base,
      id: uuidv7(),
      content:
        '所见即所得\n- [x] **加粗**、*斜体*、~~删除线~~\n- [ ] 点一下方框就能勾选\n- [ ] 双击编辑，行首输入 [] 加空格新建待办\n\n> 也可以用 Markdown 写法：# 标题、- 列表、> 引用',
      color: 'mint' as const,
      x: 680,
      y: 260,
      z: 4,
    },
  ]
}

// ---------- 本地存储：按账号分开（docs/architecture.md §5.5） ----------

/** 未登录时的“本机”数据 */
export const LOCAL_OWNER = 'local'
const LEGACY_KEY = 'stickydo.m0.notes'
const SEEDED_KEY = 'stickydo.seeded'

/** 有没有 M0/M1 的 Markdown 文本正文（需要先加载转换器） */
const hasMarkdownContent = (raw: unknown[]) => raw.some((n) => typeof (n as { content?: unknown } | null)?.content === 'string')

/** 兼容旧数据：M0/M1 的正文是 Markdown 文本，倾斜角度和创建时间存在便利贴上 */
function normalizeNote(input: unknown, markdownToDoc?: MarkdownConverter): Note | null {
  const raw = input as Record<string, unknown> | null
  if (!raw || typeof raw.id !== 'string') return null
  const content = isNoteDoc(raw.content)
    ? raw.content
    : typeof raw.content === 'string'
      ? (markdownToDoc ?? docFromText)(raw.content)
      : emptyDoc()
  const legacy = typeof raw.version !== 'number'
  return {
    id: raw.id,
    content,
    color: (raw.color as Note['color']) ?? 'lemon',
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    w: Number(raw.w) || 220,
    h: Number(raw.h) || 200,
    z: Number(raw.z) || 0,
    pinned: raw.pinned === true,
    archived: raw.archived === true,
    boardId: typeof raw.boardId === 'string' ? raw.boardId : null,
    version: legacy ? 0 : (raw.version as number),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    // 旧数据从未同步过，登录后需要上传
    dirty: legacy ? true : raw.dirty === true,
    ...(raw.sample === true ? { sample: true } : {}),
  }
}

let repoPromise: Promise<NotesRepo> | null = null

/** 打开本地存储（IndexedDB，必要时退回 localStorage），并把旧的 localStorage 数据迁移过去 */
function getRepo(): Promise<NotesRepo> {
  repoPromise ??= (async () => {
    const repo = await openNotesRepo()
    // localStorage 里还有 M2 及之前的数据时才加载 Markdown 转换器
    const md = hasLegacyLocalStorage() ? await loadMarkdown() : undefined
    await migrateFromLocalStorage(repo, (n) => normalizeNote(n, md))
    return repo
  })()
  return repoPromise
}

function hasLegacyLocalStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k === LEGACY_KEY || k?.startsWith('stickydo.notes.v2:')) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/** 把一组原始数据转成便利贴；有旧版 Markdown 正文时先加载转换器 */
async function normalizeAll(raw: unknown[]): Promise<Note[]> {
  const md = hasMarkdownContent(raw) ? await loadMarkdown() : undefined
  return raw.map((n) => normalizeNote(n, md)).filter((n): n is Note => !!n)
}

async function readPersisted(owner: string): Promise<Persisted | null> {
  const p = await (await getRepo()).load(owner)
  if (!p) return null
  return { ...p, notes: await normalizeAll(p.notes) }
}

/** 读取某个归属的数据；本机数据第一次读取时迁移最早的旧数据，或者放几张示例便利贴 */
async function loadOwner(owner: string): Promise<{ data: Persisted; saved: Persisted | null }> {
  const saved = await readPersisted(owner)
  if (saved) return { data: saved, saved }
  if (owner !== LOCAL_OWNER) return { data: emptyPersisted(), saved: null }
  // “已放过示例”的标记和删除旧 key，都要等数据真正写入存储之后（见 persistNow），
  // 否则刚打开就关掉页面，下次既没有示例也没有数据
  const legacy = load<unknown[]>(LEGACY_KEY)
  if (legacy) return { data: { ...emptyPersisted(), notes: await normalizeAll(legacy) }, saved: null }
  if (load<boolean>(SEEDED_KEY)) return { data: emptyPersisted(), saved: null }
  return { data: { ...emptyPersisted(), notes: await sampleNotes() }, saved: null }
}

// ---------- 状态 ----------

interface NotesState extends Persisted {
  /** 当前数据属于谁：LOCAL_OWNER 或用户 id */
  owner: string
  /** 本地数据是否已经读出来（IndexedDB 是异步的） */
  hydrated: boolean
  past: Snapshot[]
  future: Snapshot[]
  selectedId: string | null
  editingId: string | null

  /** 把当前状态压入撤销栈，在一次可撤销的修改之前调用 */
  checkpoint: (snapshot?: Snapshot) => void
  create: (init: Partial<Note> & Pick<Note, 'x' | 'y'>) => string
  update: (id: string, patch: Partial<Note>, opts?: { record?: boolean }) => void
  remove: (id: string, opts?: { record?: boolean }) => Note | undefined
  restore: (note: Note) => void
  /** 一次性替换多张便利贴的字段（自动排列用），整体算一步撤销 */
  patchMany: (patches: Map<string, Partial<Note>>) => void
  /** 丢弃刚新建、内容为空的便利贴，不留撤销记录 */
  discard: (id: string) => void
  bringToFront: (id: string) => void
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  setEditing: (id: string | null) => void

  /** 新建看板，返回 id */
  createBoard: (name: string, color?: NoteColor) => string
  updateBoard: (id: string, patch: Partial<Pick<Board, 'name' | 'color' | 'sortOrder'>>) => void
  /** 删除看板和其中的便利贴，整体算一步撤销；返回被删除的内容，用于提示条上的撤销 */
  deleteBoard: (id: string) => { board: Board; notes: Note[] } | undefined
  /** 撤销删除看板：把看板和便利贴放回去 */
  restoreBoard: (board: Board, notes: Note[]) => void
  /** 把便利贴移到另一个看板（null 为收件箱） */
  moveToBoard: (id: string, boardId: string | null) => void
  /** 把看板移到排序后的第 toIndex 位（拖动排序、上移 / 下移） */
  moveBoard: (id: string, toIndex: number) => void

  /** 从回收站恢复，返回恢复到的看板（原看板不在了就是收件箱） */
  restoreFromTrash: (id: string) => string | null | undefined
  /** 从回收站彻底删除（只影响本机的回收站） */
  deleteForever: (ids: string[]) => TrashItem[]
  /** 把彻底删除的放回回收站（提示条上的撤销） */
  putBackToTrash: (items: TrashItem[]) => void
}

const maxZ = (notes: Note[]) => notes.reduce((m, n) => Math.max(m, n.z), 0)

/** 已登录用户的 id（直接读登录状态的存储，避免与 auth 模块循环依赖） */
function storedUserId(): string | null {
  const id = load<{ user?: { id?: unknown } }>('stickydo.auth')?.user?.id
  return typeof id === 'string' ? id : null
}

// 页面加载时就读当前账号的数据，不会先闪一下“本机”的便利贴
const initialOwner = surface === 'web' ? (storedUserId() ?? LOCAL_OWNER) : LOCAL_OWNER

export const useNotes = create<NotesState>()((set, get) => {
  /** 所有本地编辑都经过这里：标记改动、记录墓碑（sync/merge.ts commitLocal / commitBoards） */
  const edit = (next: Note[] | Partial<Snapshot>, extra: Partial<NotesState> = {}) =>
    set((s) => {
      const n = Array.isArray(next) ? { notes: next } : next
      const now = Date.now()
      return {
        ...(n.notes && n.notes !== s.notes ? commitLocal(s, n.notes, now) : {}),
        ...(n.boards && n.boards !== s.boards ? commitBoards(s, n.boards, now) : {}),
        trash: n.notes ? updateTrash(s, n.notes, now) : s.trash,
        ...extra,
      }
    })
  const snap = (s: NotesState): Snapshot => ({ notes: s.notes, boards: s.boards })

  return {
    ...emptyPersisted(),
    owner: initialOwner,
    hydrated: false,
    past: [],
    future: [],
    selectedId: null,
    editingId: null,

    checkpoint: (snapshot) =>
      set((s) => ({
        past: [...s.past, snapshot ?? snap(s)].slice(-HISTORY_LIMIT),
        future: [],
      })),

    create: (init) => {
      const s = get()
      const board = activeBoardId()
      const note: Note = {
        id: uuidv7(),
        content: emptyDoc(),
        color: 'lemon',
        ...currentNoteSize(),
        version: 0,
        updatedAt: Date.now(),
        dirty: true,
        boardId: board && s.boards.some((b) => b.id === board) ? board : null,
        ...init,
        z: maxZ(s.notes) + 1,
      }
      s.checkpoint()
      edit([...s.notes, note], { selectedId: note.id })
      return note.id
    },

    update: (id, patch, opts) => {
      if (opts?.record !== false) get().checkpoint()
      edit(get().notes.map((n) => (n.id === id ? { ...n, ...patch } : n)))
    },

    remove: (id, opts) => {
      const s = get()
      const note = s.notes.find((n) => n.id === id)
      if (!note) return undefined
      if (opts?.record !== false) s.checkpoint()
      edit(
        s.notes.filter((n) => n.id !== id),
        {
          selectedId: s.selectedId === id ? null : s.selectedId,
          editingId: s.editingId === id ? null : s.editingId,
        },
      )
      return note
    },

    restore: (note) => {
      const s = get()
      if (s.notes.some((n) => n.id === note.id)) return
      s.checkpoint()
      edit([...s.notes, note], { selectedId: note.id })
    },

    patchMany: (patches) => {
      get().checkpoint()
      edit(get().notes.map((n) => (patches.has(n.id) ? { ...n, ...patches.get(n.id) } : n)))
    },

    discard: (id) => {
      const s = get()
      const last = s.past.at(-1)
      // 如果撤销栈顶就是“新建之前”的快照，一并去掉，这次新建就像没发生过
      const past = last && !last.notes.some((n) => n.id === id) ? s.past.slice(0, -1) : s.past
      edit(
        s.notes.filter((n) => n.id !== id),
        {
          past,
          selectedId: s.selectedId === id ? null : s.selectedId,
          editingId: s.editingId === id ? null : s.editingId,
        },
      )
    },

    bringToFront: (id) => {
      const s = get()
      const top = maxZ(s.notes)
      const note = s.notes.find((n) => n.id === id)
      if (!note || (note.z === top && s.notes.filter((n) => n.z === top).length === 1)) return
      edit(s.notes.map((n) => (n.id === id ? { ...n, z: top + 1 } : n)))
    },

    // 撤销 / 重做也是一次编辑：被恢复的便利贴会标记为改动，同步到其他设备
    undo: () => {
      const s = get()
      const prev = s.past.at(-1)
      if (!prev) return
      edit(prev, { past: s.past.slice(0, -1), future: [snap(s), ...s.future], editingId: null })
    },

    redo: () => {
      const s = get()
      const next = s.future[0]
      if (!next) return
      edit(next, { past: [...s.past, snap(s)].slice(-HISTORY_LIMIT), future: s.future.slice(1), editingId: null })
    },

    select: (id) => set({ selectedId: id }),
    setEditing: (id) => set({ editingId: id, ...(id ? { selectedId: id } : {}) }),

    createBoard: (name, color = 'sky') => {
      const s = get()
      const board: Board = {
        id: uuidv7(),
        name: name.trim() || '未命名看板',
        color,
        sortOrder: nextSortOrder(s.boards),
        version: 0,
        updatedAt: Date.now(),
        dirty: true,
      }
      s.checkpoint()
      edit({ boards: [...s.boards, board] })
      return board.id
    },

    updateBoard: (id, patch) => {
      const s = get()
      const board = s.boards.find((b) => b.id === id)
      if (!board || Object.entries(patch).every(([k, v]) => board[k as keyof Board] === v)) return
      s.checkpoint()
      edit({ boards: s.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
    },

    deleteBoard: (id) => {
      const s = get()
      const board = s.boards.find((b) => b.id === id)
      if (!board) return undefined
      const ids = new Set(s.boards.map((b) => b.id))
      const inBoard = s.notes.filter((n) => noteBoardId(n, ids) === id)
      s.checkpoint()
      edit(
        { boards: s.boards.filter((b) => b.id !== id), notes: s.notes.filter((n) => !inBoard.includes(n)) },
        {
          selectedId: inBoard.some((n) => n.id === s.selectedId) ? null : s.selectedId,
          editingId: inBoard.some((n) => n.id === s.editingId) ? null : s.editingId,
        },
      )
      return { board, notes: inBoard }
    },

    restoreBoard: (board, notes) => {
      const s = get()
      if (s.boards.some((b) => b.id === board.id)) return
      const existing = new Set(s.notes.map((n) => n.id))
      s.checkpoint()
      edit({ boards: [...s.boards, board], notes: [...s.notes, ...notes.filter((n) => !existing.has(n.id))] })
    },

    moveBoard: (id, toIndex) => {
      const s = get()
      const order = sortedBoards(s.boards)
      const from = order.findIndex((b) => b.id === id)
      const to = Math.max(0, Math.min(order.length - 1, toIndex))
      if (from < 0 || from === to) return
      const next = order.filter((b) => b.id !== id)
      next.splice(to, 0, order[from])
      s.checkpoint()
      edit({ boards: s.boards.map(withKeys(sortKeysFor(next, to))) })
    },

    restoreFromTrash: (id) => {
      const s = get()
      const item = s.trash.find((t) => t.id === id)
      if (!item) return undefined
      if (s.notes.some((n) => n.id === id)) {
        set({ trash: s.trash.filter((t) => t.id !== id) })
        return undefined
      }
      const boardId = item.note.boardId && s.boards.some((b) => b.id === item.note.boardId) ? item.note.boardId : null
      s.checkpoint()
      // 放回原来的位置，放在最上层；回收站里的这一条由 updateTrash 去掉
      edit([...s.notes, { ...item.note, boardId, z: maxZ(s.notes) + 1 }])
      return boardId
    },

    deleteForever: (ids) => {
      const s = get()
      const set_ = new Set(ids)
      const removed = s.trash.filter((t) => set_.has(t.id))
      if (removed.length) set({ trash: s.trash.filter((t) => !set_.has(t.id)) })
      return removed
    },

    putBackToTrash: (items) => {
      const s = get()
      const have = new Set([...s.trash.map((t) => t.id), ...s.notes.map((n) => n.id)])
      const back = items.filter((t) => !have.has(t.id))
      if (back.length) set({ trash: [...s.trash, ...back] })
    },

    moveToBoard: (id, boardId) => {
      const s = get()
      const note = s.notes.find((n) => n.id === id)
      if (!note || (note.boardId ?? null) === boardId) return
      s.checkpoint()
      // 移过去后放在最上层
      edit(s.notes.map((n) => (n.id === id ? { ...n, boardId, z: maxZ(s.notes) + 1 } : n)), {
        selectedId: s.selectedId === id ? null : s.selectedId,
      })
    },
  }
})

/**
 * 回收站跟着便利贴的变化走（docs/frontend-design.md §2.9）：消失的便利贴进回收站，
 * 回来的（撤销、恢复、别的设备又改了）从回收站去掉。空白的和没动过的示例不进回收站。
 */
function updateTrash(s: Pick<NotesState, 'notes' | 'boards' | 'trash'>, next: Note[], now: number): TrashItem[] {
  if (next === s.notes) return s.trash
  const nextIds = new Set(next.map((n) => n.id))
  const removed = s.notes.filter((n) => !nextIds.has(n.id) && !n.sample && !docIsEmpty(n.content))
  const back = s.trash.some((t) => nextIds.has(t.id))
  if (!removed.length && !back) return s.trash
  const removedIds = new Set(removed.map((n) => n.id))
  const names = new Map(s.boards.map((b) => [b.id, b.name]))
  return [
    ...s.trash.filter((t) => !nextIds.has(t.id) && !removedIds.has(t.id)),
    ...removed.map((note) => ({
      id: note.id,
      note,
      deletedAt: now,
      ...(note.boardId && names.has(note.boardId) ? { boardName: names.get(note.boardId) } : {}),
    })),
  ]
}

/** 去掉超过保留期的 */
const purgeTrash = (trash: TrashItem[], now = Date.now()) => {
  const kept = trash.filter((t) => now - t.deletedAt < TRASH_RETENTION_MS)
  return kept.length === trash.length ? trash : kept
}

/** 看板排序：新看板排在最后（排序键见 @stickydo/core/sync 的 keyBetween） */
function nextSortOrder(boards: Board[]): string {
  const last = boards.reduce((m, b) => (b.sortOrder > m ? b.sortOrder : m), '')
  try {
    return keyBetween(last, null)
  } catch {
    // 不认识的键（包含其他字符）：在它后面加一位，一定比它大
    return `${last}i`
  }
}

/**
 * 排好新顺序后需要换键的看板：通常只有被移动的那个（夹在前后两个之间）；
 * 前后的键不合规或顺序不对（例如两个看板的键相同）时，整列重新编号。
 */
function sortKeysFor(order: Board[], moved: number): Map<string, string> {
  const prev = order[moved - 1]?.sortOrder ?? ''
  const next = order[moved + 1]?.sortOrder ?? null
  const ok = (prev === '' || isSortKey(prev)) && (next === null || isSortKey(next)) && (next === null || prev < next)
  if (ok) return new Map([[order[moved].id, keyBetween(prev, next)]])
  const keys = new Map<string, string>()
  let k = ''
  for (const b of order) {
    k = keyBetween(k, null)
    keys.set(b.id, k)
  }
  return keys
}

const withKeys = (keys: Map<string, string>) => (b: Board) =>
  keys.has(b.id) && keys.get(b.id) !== b.sortOrder ? { ...b, sortOrder: keys.get(b.id)! } : b

/** 便利贴实际所在的看板：看板已不存在（例如在别的设备上删掉了）时算在收件箱 */
export function noteBoardId(n: Note, boardIds: Set<string>): string | null {
  return n.boardId && boardIds.has(n.boardId) ? n.boardId : null
}

/** 看板按排序键排列 */
export const sortedBoards = (boards: Board[]) =>
  [...boards].sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.id < b.id ? -1 : 1))

/** 当前白板上的便利贴 */
export function notesOnBoard(s: Pick<SyncData, 'notes' | 'boards'>, boardId: string | null): Note[] {
  const ids = new Set(s.boards.map((b) => b.id))
  const target = boardId && ids.has(boardId) ? boardId : null
  return s.notes.filter((n) => noteBoardId(n, ids) === target)
}

/** 当前显示的白板上的便利贴（快捷键、自动排列、找空位用） */
export const visibleNotes = () => notesOnBoard(useNotes.getState(), activeBoardId())

/** 当前状态作为撤销的一步 */
export const snapshotNow = (): Snapshot => {
  const s = useNotes.getState()
  return { notes: s.notes, boards: s.boards }
}

// ---------- 同步引擎调用的接口（不经过 commitLocal，不算本地编辑） ----------

/** 应用同步结果。owner 不一致（同步期间换了账号）时丢弃。 */
export function applySyncResult(owner: string, update: (d: SyncData) => SyncData, remote?: RemoteChanges) {
  useNotes.setState((s) => {
    if (s.owner !== owner) return s
    const next = update(s)
    const has = (id: string | null) => id != null && next.notes.some((n) => n.id === id)
    return {
      notes: next.notes,
      tombstones: next.tombstones,
      boards: next.boards,
      boardTombstones: next.boardTombstones,
      // 在别的设备上删除的便利贴也进回收站
      trash: updateTrash(s, next.notes, Date.now()),
      // 撤销栈跟上服务端，撤销只撤回自己的操作
      ...(remote && (remote.notes.length || remote.boards.length)
        ? { past: s.past.map((p) => patchStep(p, remote)), future: s.future.map((f) => patchStep(f, remote)) }
        : {}),
      selectedId: has(s.selectedId) ? s.selectedId : null,
      editingId: has(s.editingId) ? s.editingId : null,
    }
  })
}

export function setSyncCursor(owner: string, cursor: number) {
  useNotes.setState((s) => (s.owner === owner ? { cursor } : s))
}

// ---------- 持久化 ----------

/** 收到其他标签页的通知时，本页还有没保存的改动：保存后再重新读取 */
let reloadPending = false

const snapshotOf = (s: Persisted): Persisted => ({
  notes: s.notes,
  tombstones: s.tombstones,
  boards: s.boards,
  boardTombstones: s.boardTombstones,
  cursor: s.cursor,
  trash: s.trash,
})

const SAVE_FAILED_TOAST = 'storage-save-failed'

/** 按顺序保存，只写变化的行；失败时提示并自动重试（@stickydo/core/storage 的 saveQueue） */
const saves = createSaveQueue({
  getRepo,
  onSaved: (owner, prev) => {
    // 本机数据第一次写入成功：再记下“已放过示例”，并删除最早的旧数据
    if (owner === LOCAL_OWNER && !prev) {
      save(SEEDED_KEY, true)
      removeLegacy()
    }
    channel?.postMessage({ owner })
    if (reloadPending) {
      reloadPending = false
      void reloadFromStorage()
    }
  },
  onError: (err) => {
    console.error('[storage] 保存失败', err)
    toast.error('便利贴没能保存到本机，正在重试…', {
      id: SAVE_FAILED_TOAST,
      description: '可能是磁盘空间不足。在保存成功之前，请不要关闭页面。',
      duration: Infinity,
    })
  },
  onRecovered: () => {
    toast.success('已保存', { id: SAVE_FAILED_TOAST, description: undefined, duration: 2000 })
  },
})
const persistNow = saves.persist

function removeLegacy() {
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignore */
  }
}

/** 等待所有排队中的保存完成 */
export const flushSaves = () => saves.flush()

useNotes.subscribe((s) => {
  if (!s.hydrated) return
  persistNow(s.owner, snapshotOf(s))
})

let hydrating: Promise<void> | null = null

/** 启动时读取当前归属的数据。完成前白板不显示，避免闪一下空白板。 */
export function hydrateNotes(): Promise<void> {
  hydrating ??= (async () => {
    const owner = useNotes.getState().owner
    const { data, saved } = await loadOwner(owner)
    saves.markStored(owner, saved)
    useNotes.setState({ ...data, trash: purgeTrash(data.trash ?? []), hydrated: true })
  })()
  return hydrating
}

/**
 * 切换数据归属（登录、退出、换账号）。
 * mergeLocal：把本机（未登录时）的便利贴并入新账号，随后会上传。
 */
export async function switchOwner(owner: string, opts: { mergeLocal?: boolean } = {}) {
  await hydrateNotes()
  const s = useNotes.getState()
  if (s.owner === owner) return
  persistNow(s.owner, snapshotOf(s))
  await flushSaves()

  const { data, saved } = await loadOwner(owner)
  saves.markStored(owner, saved)
  const next: Persisted = { ...data, notes: [...data.notes], boards: [...data.boards] }
  if (opts.mergeLocal && owner !== LOCAL_OWNER) {
    const local = s.owner === LOCAL_OWNER ? snapshotOf(s) : ((await readPersisted(LOCAL_OWNER)) ?? emptyPersisted())
    const existing = new Set(next.notes.map((n) => n.id))
    const offset = maxZ(next.notes)
    const now = Date.now()
    for (const n of local.notes) {
      if (existing.has(n.id)) continue
      // 本机的便利贴对这个账号来说都是新的：版本 0，等待上传
      next.notes.push({ ...n, z: n.z + offset, version: 0, dirty: true, updatedAt: Math.max(n.updatedAt, now) })
    }
    const existingBoards = new Set(next.boards.map((b) => b.id))
    for (const b of local.boards) {
      if (!existingBoards.has(b.id)) next.boards.push({ ...b, version: 0, dirty: true, updatedAt: Math.max(b.updatedAt, now) })
    }
    // 本机回收站里的也一起带过去
    const inTrash = new Set(next.trash.map((t) => t.id))
    next.trash = [...next.trash, ...(local.trash ?? []).filter((t) => !inTrash.has(t.id))]
    if (local.notes.length || local.boards.length || local.trash?.length) persistNow(LOCAL_OWNER, emptyPersisted())
  }
  useNotes.setState({ ...next, trash: purgeTrash(next.trash ?? []), owner, hydrated: true, past: [], future: [], selectedId: null, editingId: null })
}

// ---------- 多个页面同时打开（多个标签页、插件浮窗和独立窗口） ----------

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('stickydo-notes') : null

/** 其他页面保存后：重新读取存储。本页还有未保存的改动时，等保存完再读，避免覆盖 */
async function reloadFromStorage() {
  await flushSaves()
  const s = useNotes.getState()
  if (!s.hydrated) return
  if (!saves.isStored(s.owner, snapshotOf(s))) {
    reloadPending = true
    return
  }
  const p = await readPersisted(s.owner)
  const cur = useNotes.getState()
  if (!p || cur.owner !== s.owner) return
  if (!saves.isStored(cur.owner, snapshotOf(cur))) {
    // 读取期间本页又改了：保存后再读一次
    reloadPending = true
    return
  }
  saves.markStored(cur.owner, p)
  const has = (id: string | null) => id != null && p.notes.some((n) => n.id === id)
  useNotes.setState({
    ...p,
    selectedId: has(cur.selectedId) ? cur.selectedId : null,
    // 正在编辑的便利贴保持编辑状态，结束编辑时再写入
    editingId: has(cur.editingId) ? cur.editingId : null,
  })
}

channel?.addEventListener('message', (e: MessageEvent<{ owner?: string }>) => {
  if (e.data?.owner === useNotes.getState().owner) void reloadFromStorage()
})

/** 便利贴第一行作为标题，用于提示条等场景 */
export const noteTitle = (n: Note) => {
  // 按码点截断，避免把 emoji 切成半个字符
  const chars = Array.from(docTitle(n.content))
  return chars.length > 16 ? `${chars.slice(0, 16).join('')}…` : chars.join('') || '空白便利贴'
}
