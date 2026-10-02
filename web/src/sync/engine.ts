import { createRealtime, createSyncEngine } from '@stickydo/core/sync'
import { api, API_BASE } from '../api/client'
import { surface } from '../extension/surface'
import { accessToken, useSession } from '../features/auth/session'
import { applySyncResult, hydrateNotes, LOCAL_OWNER, setSyncCursor, switchOwner, useNotes } from '../features/notes/store'
import { bindStore } from '../lib/bindStore'

export type { SyncStatus } from '@stickydo/core/sync'

/**
 * 同步：规则和流程在 @stickydo/core/sync，这里接上 Web 的部分——
 * 便利贴状态、多标签页的锁，以及切回页面、网络恢复、定时检查、实时通知这些触发时机。
 */

/** 没有实时连接时每 30 秒检查一次；连着时只作兜底，5 分钟一次 */
const INTERVAL_MS = 30_000
const INTERVAL_REALTIME_MS = 5 * 60_000

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
  // 编辑结束才推送，这里只合并连续的拖动、改色；短一些，其他设备更快看到
  editDebounceMs: 700,
})

export const useSyncStatus = bindStore(engine.status)
export const syncNow = engine.syncNow

/** 实时通知的地址：API 地址换成 ws(s) 协议 */
function realtimeUrl() {
  const base = new URL(API_BASE, location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${base.href.replace(/\/$/, '')}/sync/ws`
}

// 实时通知（docs/architecture.md §5.6）：其他设备推送了改动，服务端版本比本地游标新就立即拉取
const realtime = createRealtime({
  url: realtimeUrl,
  getToken: accessToken,
  onVersion: (v) => {
    if (v > useNotes.getState().cursor) engine.kick()
  },
})

let started = false

export function startSyncEngine() {
  // Chrome 插件目前单机使用，不同步
  if (started || surface !== 'web') return
  started = true
  engine.start()

  // 登录后连上实时通知，退出后断开
  const follow = (loggedIn: boolean) => (loggedIn ? realtime.start() : realtime.stop())
  follow(!!useSession.getState().user)
  useSession.subscribe((s, prev) => {
    if (!!s.user !== !!prev.user || s.user?.id !== prev.user?.id) {
      realtime.stop()
      follow(!!s.user)
    }
  })
  window.addEventListener('online', realtime.reconnectNow)

  window.addEventListener('online', engine.kick)
  window.addEventListener('focus', engine.kick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engine.kick()
  })
  let lastPoll = Date.now()
  setInterval(() => {
    if (document.visibilityState !== 'visible') return
    if (realtime.isConnected() && Date.now() - lastPoll < INTERVAL_REALTIME_MS) return
    lastPoll = Date.now()
    engine.kick()
  }, INTERVAL_MS)
}
