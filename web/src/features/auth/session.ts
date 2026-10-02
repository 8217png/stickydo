import { createSession, type StoredSession } from '@stickydo/core/auth'
import { api } from '../../api/client'
import { bindStore } from '../../lib/bindStore'
import { load, save } from '../../lib/storage'
import { currentDevice } from './device'

/**
 * 登录状态：逻辑在 @stickydo/core/auth（Token 刷新、401 重试），这里接上 Web 的部分：
 * - Refresh Token 与用户信息存 localStorage，刷新页面后保持登录
 * - 多个标签页通过 storage 事件共享登录状态：一处退出，处处退出
 */

const KEY = 'stickydo.auth'

const session = createSession({
  api,
  device: currentDevice,
  initial: load<StoredSession>(KEY) ?? null,
  storage: {
    load: () => load<StoredSession>(KEY) ?? null,
    save: (s) => save(KEY, s),
    clear: () => {
      try {
        localStorage.removeItem(KEY)
      } catch {
        /* ignore */
      }
    },
  },
})

export const useSession = bindStore(session.store)
export const refreshAccessToken = session.refreshAccessToken

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    session.adoptStored(e.newValue ? (JSON.parse(e.newValue) as StoredSession) : null)
  })
}
