import { createSyncEngine } from '@stickydo/core/sync'
import { api } from '../api/client'
import { surface } from '../extension/surface'
import { useSession } from '../features/auth/session'
import { applySyncResult, hydrateNotes, LOCAL_OWNER, setSyncCursor, switchOwner, useNotes } from '../features/notes/store'
import { bindStore } from '../lib/bindStore'

export type { SyncStatus } from '@stickydo/core/sync'

/**
 * 同步：规则和流程在 @stickydo/core/sync，这里接上 Web 的部分——
 * 便利贴状态、多标签页的锁，以及切回页面、网络恢复、定时检查这些触发时机。
 */

const INTERVAL_MS = 30_000

const engine = createSyncEngine({
  api,
  session: useSession,
  notes: {
    localOwner: LOCAL_OWNER,
    hydrate: hydrateNotes,
    getState: () => useNotes.getState(),
    subscribe: (listener) => useNotes.subscribe(listener),
    apply: applySyncResult,
    setCursor: setSyncCursor,
    switchOwner,
  },
  // 多个标签页同时打开时，同一时间只有一个在同步
  withLock: async (fn) => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (locks?.request) await locks.request('stickydo-sync', fn)
    else await fn()
  },
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
})

export const useSyncStatus = bindStore(engine.status)
export const syncNow = engine.syncNow

let started = false

export function startSyncEngine() {
  // Chrome 插件目前单机使用，不同步
  if (started || surface !== 'web') return
  started = true
  engine.start()

  window.addEventListener('online', engine.kick)
  window.addEventListener('focus', engine.kick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engine.kick()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') engine.kick()
  }, INTERVAL_MS)
}
