import type { NoteColor } from '../design/tokens'
import type { NoteDoc } from '../notes/doc'

/** 本地的便利贴（docs/architecture.md §5.1） */
export interface Note {
  id: string
  content: NoteDoc
  color: NoteColor
  x: number
  y: number
  w: number
  h: number
  z: number
  pinned?: boolean
  archived?: boolean
  /** 上次同步时服务端的版本；从未同步过为 0 */
  version: number
  /** 最后一次编辑的时间（毫秒） */
  updatedAt: number
  /** 上次同步之后本地改过 */
  dirty: boolean
  /** 首次使用时放的示例便利贴，任何编辑都会清除这个标记 */
  sample?: boolean
}

/** 本地删除后留下的“墓碑”，同步完成后清除 */
export interface Tombstone {
  id: string
  version: number
  deletedAt: number
}

export interface NotesData {
  notes: Note[]
  tombstones: Tombstone[]
}

/** 从服务端来的便利贴（已转换成本地字段） */
export interface RemoteNote {
  id: string
  version: number
  updatedAt: number
  deleted: boolean
  note: Omit<Note, 'version' | 'updatedAt' | 'dirty'>
}

/** 推送给服务端的一条改动 */
export interface LocalChange {
  id: string
  baseVersion: number
  updatedAt: number
  deleted: boolean
  note?: Note
}

export type PushStatus = 'applied' | 'stale' | 'invalid'
export interface PushOutcome {
  id: string
  status: PushStatus
  remote?: RemoteNote
}
