import type { NoteColor } from '../design/tokens'
import type { NoteDoc } from '../notes/doc'

/** 可同步的记录都带这些字段（docs/architecture.md §5.1） */
export interface Syncable {
  id: string
  /** 上次同步时服务端的版本；从未同步过为 0 */
  version: number
  /** 最后一次编辑的时间（毫秒） */
  updatedAt: number
  /** 上次同步之后本地改过 */
  dirty: boolean
  /** 首次使用时放的示例，任何编辑都会清除这个标记 */
  sample?: boolean
}

/** 本地的便利贴 */
export interface Note extends Syncable {
  content: NoteDoc
  color: NoteColor
  x: number
  y: number
  w: number
  h: number
  z: number
  pinned?: boolean
  archived?: boolean
  /** 所在看板；为空，或看板已不存在时，在收件箱 */
  boardId?: string | null
}

/** 本地的看板 */
export interface Board extends Syncable {
  name: string
  color: NoteColor
  /** 排序用的分数索引，按字节序比较 */
  sortOrder: string
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

export interface BoardsData {
  boards: Board[]
  boardTombstones: Tombstone[]
}

/** 同步的全部本地数据 */
export interface SyncData extends NotesData, BoardsData {}

/** 一条记录除同步信息外的字段 */
export type Fields<E extends Syncable> = Omit<E, 'version' | 'updatedAt' | 'dirty' | 'sample'>

/** 从服务端来的记录（已转换成本地字段） */
export interface Remote<E extends Syncable> {
  id: string
  version: number
  updatedAt: number
  deleted: boolean
  data: Fields<E>
}

export type RemoteNote = Remote<Note>
export type RemoteBoard = Remote<Board>

/** 一次拉取或推送带回来的服务端变化 */
export interface RemoteChanges {
  notes: RemoteNote[]
  boards: RemoteBoard[]
}

/** 推送给服务端的一条改动 */
export interface LocalChange<E extends Syncable = Note> {
  id: string
  baseVersion: number
  updatedAt: number
  deleted: boolean
  data?: E
}

export type PushStatus = 'applied' | 'stale' | 'invalid'
export interface PushOutcome<E extends Syncable = Note> {
  id: string
  status: PushStatus
  remote?: Remote<E>
}

/** 撤销栈里的一步：当时的全部便利贴和看板 */
export interface Snapshot {
  notes: Note[]
  boards: Board[]
}
