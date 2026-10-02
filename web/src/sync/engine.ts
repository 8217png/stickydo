import { create } from 'zustand'
import { api, ApiError, toApiError, type Schemas } from '../api/client'
import { surface } from '../extension/surface'
import { useSession } from '../features/auth/session'
import { applySyncResult, LOCAL_OWNER, setSyncCursor, switchOwner, useNotes } from '../features/notes/store'
import { applyPushResults, collectChanges, dropUntouchedSamples, mergePulled } from './merge'
import type { LocalChange, PushOutcome, RemoteNote } from './model'

/**
 * 同步引擎（docs/architecture.md §5.4）：
 * 拉取并合并 → 推送并处理结果 → 保存游标。只在登录后运行。
 */

export type SyncStatus = 'local' | 'synced' | 'syncing' | 'pending' | 'offline' | 'error'

export const useSyncStatus = create<{ status: SyncStatus; lastSyncedAt: number | null }>(() => ({
  status: 'local',
  lastSyncedAt: null,
}))

const EDIT_DEBOUNCE_MS = 1500
const INTERVAL_MS = 30_000
const PUSH_BATCH = 200

// ---------- 与 API 之间的转换 ----------

function toRemote(n: Schemas['Note']): RemoteNote {
  const d = n.data
  return {
    id: n.id,
    version: n.version,
    updatedAt: Date.parse(n.updated_at),
    deleted: n.deleted_at != null,
    note: {
      id: n.id,
      content: d.content as RemoteNote['note']['content'],
      color: d.color,
      x: d.pos_x,
      y: d.pos_y,
      w: d.width,
      h: d.height,
      z: d.z_index,
      pinned: d.pinned,
      archived: d.archived,
    },
  }
}

function toApiChange(c: LocalChange): Schemas['NoteChange'] {
  const n = c.note
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
    },
  }
}

// ---------- 一次同步 ----------

let running: Promise<void> | null = null
let again = false

/** 立即同步；正在同步时，结束后再跑一轮 */
export function syncNow(): Promise<void> {
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

/** 多个标签页同时打开时，同一时间只有一个在同步 */
async function withLock(fn: () => Promise<void>) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) await locks.request('stickydo-sync', fn)
  else await fn()
}

function pendingChanges() {
  const s = useNotes.getState()
  return collectChanges(s, s.editingId)
}

async function syncOnce() {
  const user = useSession.getState().user
  const owner = useNotes.getState().owner
  if (!user || owner !== user.id) return
  useSyncStatus.setState({ status: 'syncing' })
  try {
    // 1. 拉取并合并
    let cursor = useNotes.getState().cursor
    for (;;) {
      const res = await api.GET('/sync/pull', { params: { query: { since: cursor, limit: 500 } } })
      if (!res.data) throw toApiError(res.error, res.response)
      const remote = res.data.notes.map(toRemote)
      applySyncResult(owner, (d) => mergePulled(d, remote), remote)
      cursor = res.data.server_version
      setSyncCursor(owner, cursor)
      if (!res.data.has_more) break
    }
    applySyncResult(owner, dropUntouchedSamples)

    // 2. 推送本地改动
    const changes = pendingChanges()
    for (let i = 0; i < changes.length; i += PUSH_BATCH) {
      if (useNotes.getState().owner !== owner) return
      const batch = changes.slice(i, i + PUSH_BATCH)
      const res = await api.POST('/sync/push', { body: { notes: batch.map(toApiChange) } })
      if (!res.data) throw toApiError(res.error, res.response)
      const outcomes: PushOutcome[] = res.data.results.map((r) => ({
        id: r.id,
        status: r.status,
        remote: r.note ? toRemote(r.note) : undefined,
      }))
      // 服务端更新（stale）的记录也要同步到撤销栈
      const staleRemote = outcomes.filter((o) => o.status === 'stale' && o.remote).map((o) => o.remote!)
      applySyncResult(owner, (d) => applyPushResults(d, batch, outcomes), staleRemote)
    }

    if (useNotes.getState().owner !== owner) return
    useSyncStatus.setState({ status: pendingChanges().length ? 'pending' : 'synced', lastSyncedAt: Date.now() })
  } catch (err) {
    if (!useSession.getState().user) {
      useSyncStatus.setState({ status: 'local' })
      return
    }
    const offline = (err instanceof ApiError && err.code === 'network') || (typeof navigator !== 'undefined' && !navigator.onLine)
    useSyncStatus.setState({ status: offline ? 'offline' : 'error' })
    if (!offline) console.warn('[sync] 同步失败，稍后自动重试', err)
  }
}

// ---------- 何时同步 ----------

let editTimer: ReturnType<typeof setTimeout> | undefined

/** 本地有改动：停下约 1.5 秒后同步 */
function scheduleAfterEdit() {
  clearTimeout(editTimer)
  editTimer = setTimeout(() => void syncNow(), EDIT_DEBOUNCE_MS)
}

/** 登录状态变化时切换本地数据：登录后并入本机便利贴并立即同步；退出后回到本机数据 */
function followSession() {
  const user = useSession.getState().user
  const owner = useNotes.getState().owner
  if (user && owner !== user.id) {
    switchOwner(user.id, { mergeLocal: true })
  } else if (!user && owner !== LOCAL_OWNER) {
    clearTimeout(editTimer)
    switchOwner(LOCAL_OWNER)
  }
  if (user) {
    if (useSyncStatus.getState().status === 'local') useSyncStatus.setState({ status: pendingChanges().length ? 'pending' : 'syncing' })
    void syncNow()
  } else {
    useSyncStatus.setState({ status: 'local', lastSyncedAt: null })
  }
}

let started = false

export function startSyncEngine() {
  // Chrome 插件目前单机使用，不同步
  if (started || surface !== 'web') return
  started = true

  followSession()
  let lastUserId = useSession.getState().user?.id ?? null
  useSession.subscribe((s) => {
    const id = s.user?.id ?? null
    if (id === lastUserId) return
    lastUserId = id
    followSession()
  })

  // 本地编辑（包括结束编辑一张便利贴）后安排同步
  useNotes.subscribe((s, prev) => {
    if (!useSession.getState().user) return
    const edited = s.notes !== prev.notes || s.tombstones !== prev.tombstones || s.editingId !== prev.editingId
    if (!edited || s.owner !== prev.owner) return
    if (collectChanges(s, s.editingId).length === 0) return
    if (useSyncStatus.getState().status === 'synced') useSyncStatus.setState({ status: 'pending' })
    scheduleAfterEdit()
  })

  const kick = () => {
    if (useSession.getState().user) void syncNow()
  }
  window.addEventListener('online', kick)
  window.addEventListener('focus', kick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') kick()
  }, INTERVAL_MS)
}
