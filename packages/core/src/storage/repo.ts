import type { Note, SyncData } from '../sync/model'

/**
 * 便利贴本地存储的接口（docs/architecture.md §5.5）：每个端各自实现，
 * Web 用 IndexedDB（web/src/storage/notesRepo.ts），移动端用 SQLite。
 */

export interface Persisted extends SyncData {
  /** 同步游标：上次拉取到的服务端版本 */
  cursor: number
  /** 回收站：本机删除的、或在其他设备上被删除的便利贴，保留 30 天（只在本机，不同步） */
  trash: TrashItem[]
}

export interface TrashItem {
  /** 便利贴 id */
  id: string
  /** 删除前的便利贴 */
  note: Note
  /** 删除时间（毫秒） */
  deletedAt: number
  /** 删除时所在看板的名字（看板也可能已经删除） */
  boardName?: string
}

/** 回收站保留多久 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface NotesRepo {
  /** 实现方式，例如 indexeddb、localstorage、sqlite */
  readonly kind: string
  /** 读取某个归属（本机或某个账号）的全部数据；从未保存过返回 null */
  load(owner: string): Promise<Persisted | null>
  /** 保存：与 prev（上次保存的内容）比较，只写入变化的部分 */
  save(owner: string, prev: Persisted | null, next: Persisted): Promise<void>
}

export const emptyPersisted = (): Persisted => ({ notes: [], tombstones: [], boards: [], boardTombstones: [], cursor: 0, trash: [] })
