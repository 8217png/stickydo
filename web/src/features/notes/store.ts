import { create } from 'zustand'
import type { NoteColor } from '../../design/colors'
import { uuidv7 } from '../../lib/id'
import { load, save } from '../../lib/storage'

export interface Note {
  id: string
  content: string
  color: NoteColor
  x: number
  y: number
  w: number
  h: number
  z: number
  /** 随机倾斜角度（度），创建时确定，保持稳定 */
  tilt: number
  createdAt: number
}

export const NOTE_DEFAULT_SIZE = { w: 220, h: 200 }
const HISTORY_LIMIT = 20
const STORAGE_KEY = 'stickydo.m0.notes'

const randomTilt = () => Math.round((Math.random() * 3 - 1.5) * 10) / 10

function sampleNotes(): Note[] {
  const now = Date.now()
  const base = { w: 230, h: 190, createdAt: now }
  return [
    {
      ...base,
      id: uuidv7(),
      content: '欢迎来到 Sticky-Do 👋\n双击空白处，就能贴上一张新便利贴。',
      color: 'lemon',
      x: 120,
      y: 110,
      z: 1,
      tilt: -1.2,
    },
    {
      ...base,
      id: uuidv7(),
      content: '拖我试试\n按住拖动，拖到哪里放到哪里。拖右下角可以调整大小。',
      color: 'sky',
      x: 400,
      y: 170,
      z: 2,
      tilt: 1.1,
    },
    {
      ...base,
      id: uuidv7(),
      content: '换个颜色\n选中后按 1–8 换色，按 Delete 删除——随时可以 Ctrl+Z 撤销。按 ? 查看全部快捷键。',
      color: 'blossom',
      x: 260,
      y: 400,
      h: 200,
      z: 3,
      tilt: -0.6,
    },
  ]
}

interface NotesState {
  notes: Note[]
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
  /** 丢弃刚新建、内容为空的便利贴，不留撤销记录 */
  discard: (id: string) => void
  bringToFront: (id: string) => void
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  setEditing: (id: string | null) => void
}

const maxZ = (notes: Note[]) => notes.reduce((m, n) => Math.max(m, n.z), 0)

export const useNotes = create<NotesState>()((set, get) => ({
  notes: load<Note[]>(STORAGE_KEY) ?? sampleNotes(),
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
      content: '',
      color: 'lemon',
      ...NOTE_DEFAULT_SIZE,
      tilt: randomTilt(),
      createdAt: Date.now(),
      ...init,
      z: maxZ(s.notes) + 1,
    }
    s.checkpoint()
    set((s) => ({ notes: [...s.notes, note], selectedId: note.id }))
    return note.id
  },

  update: (id, patch, opts) => {
    if (opts?.record !== false) get().checkpoint()
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
  },

  remove: (id, opts) => {
    const s = get()
    const note = s.notes.find((n) => n.id === id)
    if (!note) return undefined
    if (opts?.record !== false) s.checkpoint()
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      editingId: s.editingId === id ? null : s.editingId,
    }))
    return note
  },

  restore: (note) => {
    const s = get()
    if (s.notes.some((n) => n.id === note.id)) return
    s.checkpoint()
    set((s) => ({ notes: [...s.notes, note], selectedId: note.id }))
  },

  discard: (id) =>
    set((s) => {
      const last = s.past.at(-1)
      // 如果撤销栈顶就是“新建之前”的快照，一并去掉，这次新建就像没发生过
      const past = last && !last.some((n) => n.id === id) ? s.past.slice(0, -1) : s.past
      return {
        notes: s.notes.filter((n) => n.id !== id),
        past,
        selectedId: s.selectedId === id ? null : s.selectedId,
        editingId: s.editingId === id ? null : s.editingId,
      }
    }),

  bringToFront: (id) =>
    set((s) => {
      const top = maxZ(s.notes)
      const note = s.notes.find((n) => n.id === id)
      if (!note || (note.z === top && s.notes.filter((n) => n.z === top).length === 1)) return s
      return { notes: s.notes.map((n) => (n.id === id ? { ...n, z: top + 1 } : n)) }
    }),

  undo: () =>
    set((s) => {
      const prev = s.past.at(-1)
      if (!prev) return s
      return {
        notes: prev,
        past: s.past.slice(0, -1),
        future: [s.notes, ...s.future],
        editingId: null,
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return s
      return {
        notes: next,
        past: [...s.past, s.notes].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        editingId: null,
      }
    }),

  select: (id) => set({ selectedId: id }),
  setEditing: (id) => set({ editingId: id, ...(id ? { selectedId: id } : {}) }),
}))

// 持久化：只存便利贴本身，撤销栈不跨刷新保留
let lastSaved: Note[] | undefined
useNotes.subscribe((s) => {
  if (s.notes === lastSaved) return
  lastSaved = s.notes
  save(STORAGE_KEY, s.notes)
})

/** 便利贴第一行作为标题，用于提示条等场景 */
export const noteTitle = (n: Note) => {
  const first = n.content.split('\n').find((l) => l.trim()) ?? ''
  // 按码点截断，避免把 emoji 切成半个字符
  const chars = Array.from(first.trim())
  return chars.length > 16 ? `${chars.slice(0, 16).join('')}…` : chars.join('') || '空白便利贴'
}
