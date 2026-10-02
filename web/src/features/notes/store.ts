import { create } from 'zustand'
import { uuidv7 } from '../../lib/id'
import { load, save } from '../../lib/storage'
import { type NoteSizeKey, useSettings } from '../settings'
import { currentPopupSize } from '../../extension/popupSize'
import { surface } from '../../extension/surface'
import { commitLocal, patchSnapshot } from '../../sync/merge'
import type { Note, NotesData, RemoteNote, Tombstone } from '../../sync/model'
import { docTitle, emptyDoc, isNoteDoc, markdownToDoc } from './doc'
import { gridLayout } from './layout'

export type { Note }

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

function sampleNotes(): Note[] {
  const now = Date.now()
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
const keyFor = (owner: string) => `stickydo.notes.v2:${owner}`
const LEGACY_KEY = 'stickydo.m0.notes'
const SEEDED_KEY = 'stickydo.seeded'

interface Persisted extends NotesData {
  /** 同步游标：上次拉取到的服务端版本 */
  cursor: number
}

const emptyPersisted = (): Persisted => ({ notes: [], tombstones: [], cursor: 0 })

/** 兼容旧数据：M0/M1 的正文是 Markdown 文本，倾斜角度和创建时间存在便利贴上 */
function normalizeNote(raw: Record<string, unknown>): Note | null {
  if (typeof raw.id !== 'string') return null
  const content = isNoteDoc(raw.content) ? raw.content : typeof raw.content === 'string' ? markdownToDoc(raw.content) : emptyDoc()
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
    version: legacy ? 0 : (raw.version as number),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    // 旧数据从未同步过，登录后需要上传
    dirty: legacy ? true : raw.dirty === true,
    ...(raw.sample === true ? { sample: true } : {}),
  }
}

function readPersisted(owner: string): Persisted | null {
  const p = load<Partial<Persisted>>(keyFor(owner))
  if (!p) return null
  return {
    notes: (p.notes ?? []).map((n) => normalizeNote(n as unknown as Record<string, unknown>)).filter((n): n is Note => !!n),
    tombstones: p.tombstones ?? [],
    cursor: p.cursor ?? 0,
  }
}

function loadOwner(owner: string): Persisted {
  const p = readPersisted(owner)
  if (p) return p
  if (owner !== LOCAL_OWNER) return emptyPersisted()
  // 本机数据第一次读取：迁移旧版数据，或者放几张示例便利贴
  const legacy = load<Record<string, unknown>[]>(LEGACY_KEY)
  if (legacy) {
    const migrated: Persisted = { ...emptyPersisted(), notes: legacy.map(normalizeNote).filter((n): n is Note => !!n) }
    save(keyFor(LOCAL_OWNER), migrated)
    save(SEEDED_KEY, true)
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* ignore */
    }
    return migrated
  }
  if (load<boolean>(SEEDED_KEY)) return emptyPersisted()
  // 示例便利贴立即保存：否则没有任何编辑时不会写入，刷新后就没了
  const seeded: Persisted = { ...emptyPersisted(), notes: sampleNotes() }
  save(keyFor(LOCAL_OWNER), seeded)
  save(SEEDED_KEY, true)
  return seeded
}

// ---------- 状态 ----------

interface NotesState extends Persisted {
  /** 当前数据属于谁：LOCAL_OWNER 或用户 id */
  owner: string
  past: Note[][]
  future: Note[][]
  selectedId: string | null
  editingId: string | null

  /** 把当前状态压入撤销栈，在一次可撤销的修改之前调用 */
  checkpoint: (snapshot?: Note[]) => void
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
}

const maxZ = (notes: Note[]) => notes.reduce((m, n) => Math.max(m, n.z), 0)

/** 已登录用户的 id（直接读登录状态的存储，避免与 auth 模块循环依赖） */
function storedUserId(): string | null {
  const id = load<{ user?: { id?: unknown } }>('stickydo.auth')?.user?.id
  return typeof id === 'string' ? id : null
}

// 页面加载时就读当前账号的数据，不会先闪一下“本机”的便利贴
const initialOwner = surface === 'web' ? (storedUserId() ?? LOCAL_OWNER) : LOCAL_OWNER
const initial = loadOwner(initialOwner)

export const useNotes = create<NotesState>()((set, get) => {
  /** 所有本地编辑都经过这里：标记改动、记录墓碑（sync/merge.ts commitLocal） */
  const edit = (next: Note[], extra: Partial<NotesState> = {}) =>
    set((s) => ({ ...commitLocal(s, next, Date.now()), ...extra }))

  return {
    ...initial,
    owner: initialOwner,
    past: [],
    future: [],
    selectedId: null,
    editingId: null,

    checkpoint: (snapshot) =>
      set((s) => ({
        past: [...s.past, snapshot ?? s.notes].slice(-HISTORY_LIMIT),
        future: [],
      })),

    create: (init) => {
      const s = get()
      const note: Note = {
        id: uuidv7(),
        content: emptyDoc(),
        color: 'lemon',
        ...currentNoteSize(),
        version: 0,
        updatedAt: Date.now(),
        dirty: true,
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
      const past = last && !last.some((n) => n.id === id) ? s.past.slice(0, -1) : s.past
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
      edit(prev, { past: s.past.slice(0, -1), future: [s.notes, ...s.future], editingId: null })
    },

    redo: () => {
      const s = get()
      const next = s.future[0]
      if (!next) return
      edit(next, { past: [...s.past, s.notes].slice(-HISTORY_LIMIT), future: s.future.slice(1), editingId: null })
    },

    select: (id) => set({ selectedId: id }),
    setEditing: (id) => set({ editingId: id, ...(id ? { selectedId: id } : {}) }),
  }
})

// ---------- 同步引擎调用的接口（不经过 commitLocal，不算本地编辑） ----------

/** 应用同步结果。owner 不一致（同步期间换了账号）时丢弃。 */
export function applySyncResult(owner: string, update: (d: NotesData) => NotesData, remoteChanges: RemoteNote[] = []) {
  useNotes.setState((s) => {
    if (s.owner !== owner) return s
    const next = update(s)
    const has = (id: string | null) => id != null && next.notes.some((n) => n.id === id)
    return {
      notes: next.notes,
      tombstones: next.tombstones,
      // 撤销栈跟上服务端，撤销只撤回自己的操作
      ...(remoteChanges.length
        ? { past: s.past.map((p) => patchSnapshot(p, remoteChanges)), future: s.future.map((f) => patchSnapshot(f, remoteChanges)) }
        : {}),
      selectedId: has(s.selectedId) ? s.selectedId : null,
      editingId: has(s.editingId) ? s.editingId : null,
    }
  })
}

export function setSyncCursor(owner: string, cursor: number) {
  useNotes.setState((s) => (s.owner === owner ? { cursor } : s))
}

/**
 * 切换数据归属（登录、退出、换账号）。
 * mergeLocal：把本机（未登录时）的便利贴并入新账号，随后会上传。
 */
export function switchOwner(owner: string, opts: { mergeLocal?: boolean } = {}) {
  const s = useNotes.getState()
  if (s.owner === owner) return
  save(keyFor(s.owner), { notes: s.notes, tombstones: s.tombstones, cursor: s.cursor } satisfies Persisted)

  const next = loadOwner(owner)
  if (opts.mergeLocal && owner !== LOCAL_OWNER) {
    const local = s.owner === LOCAL_OWNER ? s : (readPersisted(LOCAL_OWNER) ?? emptyPersisted())
    const existing = new Set(next.notes.map((n) => n.id))
    const offset = maxZ(next.notes)
    const now = Date.now()
    for (const n of local.notes) {
      if (existing.has(n.id)) continue
      // 本机的便利贴对这个账号来说都是新的：版本 0，等待上传
      next.notes.push({ ...n, z: n.z + offset, version: 0, dirty: true, updatedAt: Math.max(n.updatedAt, now) })
    }
    if (local.notes.length) save(keyFor(LOCAL_OWNER), emptyPersisted())
  }
  lastSaved = undefined
  useNotes.setState({ ...next, owner, past: [], future: [], selectedId: null, editingId: null })
}

// ---------- 持久化 ----------

let lastSaved: Note[] | undefined
let lastSavedTombs: Tombstone[] | undefined
let lastSavedCursor = -1
useNotes.subscribe((s) => {
  if (s.notes === lastSaved && s.tombstones === lastSavedTombs && s.cursor === lastSavedCursor) return
  lastSaved = s.notes
  lastSavedTombs = s.tombstones
  lastSavedCursor = s.cursor
  save(keyFor(s.owner), { notes: s.notes, tombstones: s.tombstones, cursor: s.cursor } satisfies Persisted)
})

// 多个页面同时打开（插件浮窗和独立窗口、多个标签页）时，其他页面的修改实时同步过来
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const s = useNotes.getState()
    if (e.key !== keyFor(s.owner) || e.newValue == null) return
    const p = readPersisted(s.owner)
    if (!p) return
    lastSaved = p.notes
    lastSavedTombs = p.tombstones
    lastSavedCursor = p.cursor
    useNotes.setState((cur) => {
      const has = (id: string | null) => id != null && p.notes.some((n) => n.id === id)
      return {
        ...p,
        selectedId: has(cur.selectedId) ? cur.selectedId : null,
        // 正在编辑的便利贴保持编辑状态，结束编辑时再写入
        editingId: has(cur.editingId) ? cur.editingId : null,
      }
    })
  })
}

/** 便利贴第一行作为标题，用于提示条等场景 */
export const noteTitle = (n: Note) => {
  // 按码点截断，避免把 emoji 切成半个字符
  const chars = Array.from(docTitle(n.content))
  return chars.length > 16 ? `${chars.slice(0, 16).join('')}…` : chars.join('') || '空白便利贴'
}
