import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, toApiError, type ApiClient, type Schemas } from '../api/client'
import type { SessionState } from '../auth/session'
import {
  applyBoardPushResults,
  applyPushResults,
  collectBoardChanges,
  collectChanges,
  dropUntouchedSamples,
  hasPendingChanges,
  mergePulledAll,
} from './merge'
import type { Board, LocalChange, Note, PushOutcome, RemoteBoard, RemoteChanges, RemoteNote, SyncData } from './model'

/**
 * 同步引擎（docs/architecture.md §5.4）：
 * 拉取并合并 → 推送并处理结果 → 保存游标。只在登录后运行。
 * “何时同步”中与平台有关的触发（切回页面、网络恢复、定时）由各端调用 kick()。
 */

export type SyncStatus = 'local' | 'synced' | 'syncing' | 'pending' | 'offline' | 'error'

export interface SyncStatusState {
  status: SyncStatus
  lastSyncedAt: number | null
}

/** 同步引擎读写的本地状态：便利贴和看板 */
export interface NotesSnapshot extends SyncData {
  /** 当前数据属于谁：localOwner 或用户 id */
  owner: string
  cursor: number
  /** 正在编辑的便利贴：等编辑结束再推送 */
  editingId: string | null
}

/** 本地便利贴状态的接口，由各端实现 */
export interface NotesSource {
  /** 未登录时“本机”数据的归属 */
  localOwner: string
  /** 等待本地数据读出来 */
  hydrate(): Promise<void>
  getState(): NotesSnapshot
  subscribe(listener: (s: NotesSnapshot, prev: NotesSnapshot) => void): () => void
  /** 应用同步结果；owner 不一致（同步期间换了账号）时丢弃。remoteChanges 用于更新撤销栈 */
  apply(owner: string, update: (d: SyncData) => SyncData, remoteChanges?: RemoteChanges): void
  setCursor(owner: string, cursor: number): void
  /** 切换数据归属（登录、退出、换账号）；mergeLocal：把本机数据并入新账号 */
  switchOwner(owner: string, opts?: { mergeLocal?: boolean }): Promise<void>
}

export interface SyncEngineOptions {
  api: ApiClient
  session: Pick<StoreApi<SessionState>, 'getState' | 'subscribe'>
  notes: NotesSource
  /** 多个页面（标签页）同时运行时，保证同一时间只有一个在同步 */
  withLock?: (fn: () => Promise<void>) => Promise<void>
  /** 设备当前是否联网（用来区分“离线”和“出错”） */
  isOnline?: () => boolean
  /** 本地改动停下多久后同步 */
  editDebounceMs?: number
}

export interface SyncEngine {
  status: StoreApi<SyncStatusState>
  /** 立即同步；正在同步时，结束后再跑一轮 */
  syncNow: () => Promise<void>
  /** 已登录时同步一次（切回页面、网络恢复、定时检查时调用） */
  kick: () => void
  /** 开始跟随登录状态和本地编辑 */
  start: () => void
}

const PUSH_BATCH = 200

// ---------- 与 API 之间的转换 ----------

function toRemote(n: Schemas['Note']): RemoteNote {
  const d = n.data
  return {
    id: n.id,
    version: n.version,
    updatedAt: Date.parse(n.updated_at),
    deleted: n.deleted_at != null,
    data: {
      id: n.id,
      content: d.content as RemoteNote['data']['content'],
      color: d.color,
      x: d.pos_x,
      y: d.pos_y,
      w: d.width,
      h: d.height,
      z: d.z_index,
      pinned: d.pinned,
      archived: d.archived,
      boardId: d.board_id ?? null,
    },
  }
}

function toRemoteBoard(b: Schemas['Board']): RemoteBoard {
  return {
    id: b.id,
    version: b.version,
    updatedAt: Date.parse(b.updated_at),
    deleted: b.deleted_at != null,
    data: { id: b.id, name: b.data.name, color: b.data.color, sortOrder: b.data.sort_order },
  }
}

function toApiBoardChange(c: LocalChange<Board>): Schemas['BoardChange'] {
  const b = c.data
  return {
    id: c.id,
    base_version: c.baseVersion,
    updated_at: new Date(c.updatedAt).toISOString(),
    deleted: c.deleted,
    data: b && { name: Array.from(b.name.trim() || '未命名').slice(0, 60).join(''), color: b.color, sort_order: b.sortOrder.slice(0, 64) },
  }
}

function toApiChange(c: LocalChange<Note>): Schemas['NoteChange'] {
  const n = c.data
  return {
    id: c.id,
    base_version: c.baseVersion,
    updated_at: new Date(c.updatedAt).toISOString(),
    deleted: c.deleted,
    data: n && {
      content: n.content as Record<string, unknown>,
      color: n.color,
      pos_x: n.x,
      pos_y: n.y,
      width: Math.max(40, n.w),
      height: Math.max(40, n.h),
      z_index: Math.round(n.z),
      pinned: n.pinned ?? false,
      archived: n.archived ?? false,
      board_id: n.boardId ?? null,
    },
  }
}

export function createSyncEngine({
  api,
  session,
  notes,
  withLock = (fn) => fn(),
  isOnline = () => true,
  editDebounceMs = 1500,
}: SyncEngineOptions): SyncEngine {
  const status = createStore<SyncStatusState>()(() => ({ status: 'local', lastSyncedAt: null }))
  const setStatus = (s: Partial<SyncStatusState>) => status.setState(s)

  // ---------- 一次同步 ----------

  let running: Promise<void> | null = null
  let again = false

  function syncNow(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        do {
          again = false
          await withLock(syncOnce)
        } while (again)
      } finally {
        running = null
      }
    })()
    return running
  }

  function hasPending() {
    const s = notes.getState()
    return hasPendingChanges(s, s.editingId)
  }

  async function syncOnce() {
    await notes.hydrate()
    const user = session.getState().user
    const owner = notes.getState().owner
    if (!user || owner !== user.id) return
    setStatus({ status: 'syncing' })
    try {
      // 1. 拉取并合并
      let cursor = notes.getState().cursor
      for (;;) {
        const res = await api.GET('/sync/pull', { params: { query: { since: cursor, limit: 500 } } })
        if (!res.data) throw toApiError(res.error, res.response)
        const remote: RemoteChanges = { notes: res.data.notes.map(toRemote), boards: res.data.boards.map(toRemoteBoard) }
        notes.apply(owner, (d) => mergePulledAll(d, remote), remote)
        cursor = res.data.server_version
        notes.setCursor(owner, cursor)
        if (!res.data.has_more) break
      }
      notes.apply(owner, dropUntouchedSamples)

      // 2. 推送本地改动：先推看板，便利贴才能引用新建的看板
      const s = notes.getState()
      const boardChanges = collectBoardChanges(s)
      const changes = collectChanges(s, s.editingId)
      for (let i = 0; i < boardChanges.length; i += PUSH_BATCH) {
        if (notes.getState().owner !== owner) return
        const batch = boardChanges.slice(i, i + PUSH_BATCH)
        const res = await api.POST('/sync/push', { body: { notes: [], boards: batch.map(toApiBoardChange) } })
        if (!res.data) throw toApiError(res.error, res.response)
        const outcomes: PushOutcome<Board>[] = res.data.board_results.map((r) => ({
          id: r.id,
          status: r.status,
          remote: r.board ? toRemoteBoard(r.board) : undefined,
        }))
        const stale = outcomes.filter((o) => o.status === 'stale' && o.remote).map((o) => o.remote!)
        notes.apply(owner, (d) => ({ ...d, ...applyBoardPushResults(d, batch, outcomes) }), { notes: [], boards: stale })
      }
      for (let i = 0; i < changes.length; i += PUSH_BATCH) {
        if (notes.getState().owner !== owner) return
        const batch = changes.slice(i, i + PUSH_BATCH)
        const res = await api.POST('/sync/push', { body: { notes: batch.map(toApiChange) } })
        if (!res.data) throw toApiError(res.error, res.response)
        const outcomes: PushOutcome<Note>[] = res.data.results.map((r) => ({
          id: r.id,
          status: r.status,
          remote: r.note ? toRemote(r.note) : undefined,
        }))
        // 服务端更新（stale）的记录也要同步到撤销栈
        const stale = outcomes.filter((o) => o.status === 'stale' && o.remote).map((o) => o.remote!)
        notes.apply(owner, (d) => ({ ...d, ...applyPushResults(d, batch, outcomes) }), { notes: stale, boards: [] })
      }

      if (notes.getState().owner !== owner) return
      setStatus({ status: hasPending() ? 'pending' : 'synced', lastSyncedAt: Date.now() })
    } catch (err) {
      if (!session.getState().user) {
        setStatus({ status: 'local' })
        return
      }
      const offline = (err instanceof ApiError && err.code === 'network') || !isOnline()
      setStatus({ status: offline ? 'offline' : 'error' })
      if (!offline) console.warn('[sync] 同步失败，稍后自动重试', err)
    }
  }

  // ---------- 何时同步 ----------

  let editTimer: ReturnType<typeof setTimeout> | undefined

  /** 本地有改动：停下一会儿后同步 */
  function scheduleAfterEdit() {
    clearTimeout(editTimer)
    editTimer = setTimeout(() => void syncNow(), editDebounceMs)
  }

  /** 登录状态变化时切换本地数据：登录后并入本机便利贴并立即同步；退出后回到本机数据 */
  async function followSession() {
    await notes.hydrate()
    const user = session.getState().user
    const owner = notes.getState().owner
    if (user && owner !== user.id) {
      await notes.switchOwner(user.id, { mergeLocal: true })
    } else if (!user && owner !== notes.localOwner) {
      clearTimeout(editTimer)
      await notes.switchOwner(notes.localOwner)
    }
    // 切换期间登录状态又变了：以最新的为准，由下一次 followSession 处理
    if ((session.getState().user?.id ?? null) !== (user?.id ?? null)) return
    if (user) {
      if (status.getState().status === 'local') setStatus({ status: hasPending() ? 'pending' : 'syncing' })
      void syncNow()
    } else {
      setStatus({ status: 'local', lastSyncedAt: null })
    }
  }

  const kick = () => {
    if (session.getState().user) void syncNow()
  }

  let started = false

  function start() {
    if (started) return
    started = true

    void followSession()
    let lastUserId = session.getState().user?.id ?? null
    session.subscribe((s) => {
      const id = s.user?.id ?? null
      if (id === lastUserId) return
      lastUserId = id
      void followSession()
    })

    // 本地编辑（包括结束编辑一张便利贴）后安排同步
    notes.subscribe((s, prev) => {
      if (!session.getState().user) return
      const edited =
        s.notes !== prev.notes ||
        s.tombstones !== prev.tombstones ||
        s.boards !== prev.boards ||
        s.boardTombstones !== prev.boardTombstones ||
        s.editingId !== prev.editingId
      if (!edited || s.owner !== prev.owner) return
      if (!hasPendingChanges(s, s.editingId)) return
      if (status.getState().status === 'synced') setStatus({ status: 'pending' })
      scheduleAfterEdit()
    })
  }

  return { status, syncNow, kick, start }
}
