import { create } from 'zustand'
import { api, ApiError, toApiError, useApiMiddleware, type Schemas, type User } from '../../api/client'
import { load, save } from '../../lib/storage'
import { currentDevice } from './device'

/**
 * 登录状态（docs/architecture.md §2：基于 Token，不依赖 Cookie）
 * - Refresh Token 与用户信息存 localStorage，刷新页面后保持登录
 * - Access Token 只放内存，页面加载后第一次请求时用 Refresh Token 换取
 * - 多个标签页通过 storage 事件共享登录状态：一处退出，处处退出
 */

const KEY = 'stickydo.auth'
/** Access Token 剩余不到这么久就提前刷新 */
const EXPIRY_SKEW_MS = 30_000

interface Stored {
  user: User
  deviceId: string
  refreshToken: string
  refreshExpiresAt: string
}

interface SessionState {
  user: User | null
  deviceId: string | null
  refreshToken: string | null
  accessToken: string | null
  accessExpiresAt: number

  login: (email: string, password: string) => Promise<User>
  register: (email: string, password: string, name?: string) => Promise<User>
  logout: () => Promise<void>
  /** 用服务端的最新信息更新当前用户（例如页面加载后） */
  reloadUser: () => Promise<void>
}

const stored = load<Stored>(KEY)

export const useSession = create<SessionState>()((set, get) => ({
  user: stored?.user ?? null,
  deviceId: stored?.deviceId ?? null,
  refreshToken: stored?.refreshToken ?? null,
  accessToken: null,
  accessExpiresAt: 0,

  login: async (email, password) => {
    const { data, error, response } = await api.POST('/auth/login', {
      body: { email, password, device: currentDevice() },
    })
    if (!data) throw toApiError(error, response)
    adopt(data)
    return data.user
  },

  register: async (email, password, name) => {
    const { data, error, response } = await api.POST('/auth/register', {
      body: { email, password, name: name || undefined, device: currentDevice() },
    })
    if (!data) throw toApiError(error, response)
    adopt(data)
    return data.user
  },

  logout: async () => {
    if (get().refreshToken) {
      // 服务端吊销失败（例如离线）也照样在本地退出
      await api.POST('/auth/logout').catch(() => undefined)
    }
    clear()
  },

  reloadUser: async () => {
    if (!get().refreshToken) return
    const { data } = await api.GET('/me')
    if (data) {
      set({ user: data })
      persist()
    }
  },
}))

function adopt(res: Schemas['AuthResponse']) {
  useSession.setState({
    user: res.user,
    deviceId: res.device_id,
    refreshToken: res.tokens.refresh_token,
    accessToken: res.tokens.access_token,
    accessExpiresAt: Date.parse(res.tokens.access_expires_at),
  })
  persist(res.tokens.refresh_expires_at)
}

function persist(refreshExpiresAt?: string) {
  const s = useSession.getState()
  if (!s.user || !s.deviceId || !s.refreshToken) return
  const prev = load<Stored>(KEY)
  save(KEY, {
    user: s.user,
    deviceId: s.deviceId,
    refreshToken: s.refreshToken,
    refreshExpiresAt: refreshExpiresAt ?? prev?.refreshExpiresAt ?? '',
  } satisfies Stored)
}

function clear() {
  useSession.setState({ user: null, deviceId: null, refreshToken: null, accessToken: null, accessExpiresAt: 0 })
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

// ---------- 刷新令牌 ----------

let inflight: Promise<string | null> | null = null

/** 换一个新的 Access Token；同一时间只发一个刷新请求。失败（会话失效）时退出登录并返回 null。 */
export function refreshAccessToken(): Promise<string | null> {
  inflight ??= doRefresh().finally(() => (inflight = null))
  return inflight
}

async function doRefresh(retried = false): Promise<string | null> {
  const token = useSession.getState().refreshToken
  if (!token) return null
  const res = await api.POST('/auth/refresh', { body: { refresh_token: token } }).catch(() => {
    throw ApiError.network()
  })
  if (res.data) {
    useSession.setState({
      refreshToken: res.data.refresh_token,
      accessToken: res.data.access_token,
      accessExpiresAt: Date.parse(res.data.access_expires_at),
    })
    persist(res.data.refresh_expires_at)
    return res.data.access_token
  }
  if (res.response.status === 401) {
    // 另一个标签页可能刚刚刷新过：读一下存储里有没有更新的 Refresh Token
    const latest = load<Stored>(KEY)?.refreshToken
    if (!retried && latest && latest !== token) {
      useSession.setState({ refreshToken: latest })
      return doRefresh(true)
    }
    clear()
    return null
  }
  throw toApiError(res.error, res.response)
}

async function validAccessToken(): Promise<string | null> {
  const s = useSession.getState()
  if (!s.refreshToken) return null
  if (s.accessToken && s.accessExpiresAt - Date.now() > EXPIRY_SKEW_MS) return s.accessToken
  return refreshAccessToken()
}

// ---------- 请求中间件 ----------

const PUBLIC = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/healthz'])
const retryable = new Map<string, Request>()

useApiMiddleware({
  async onRequest({ request, schemaPath, id }) {
    if (PUBLIC.has(schemaPath)) return
    const token = await validAccessToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    // 留一份副本：如果 401，刷新令牌后用它重试一次
    retryable.set(id, request.clone())
    return request
  },
  async onResponse({ response, schemaPath, id }) {
    const copy = retryable.get(id)
    retryable.delete(id)
    if (response.status !== 401 || PUBLIC.has(schemaPath) || !copy) return
    if (!useSession.getState().refreshToken) return
    const token = await refreshAccessToken()
    if (!token) return
    copy.headers.set('Authorization', `Bearer ${token}`)
    return fetch(copy)
  },
  onError({ id }) {
    retryable.delete(id)
    return ApiError.network()
  },
})

// ---------- 多标签页同步 ----------

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    const next = e.newValue ? (JSON.parse(e.newValue) as Stored) : null
    if (!next) {
      clear()
      return
    }
    const cur = useSession.getState()
    useSession.setState({
      user: next.user,
      deviceId: next.deviceId,
      refreshToken: next.refreshToken,
      // 换了账号或令牌：作废内存里的 Access Token，下次请求时重新获取
      ...(cur.refreshToken !== next.refreshToken ? { accessToken: null, accessExpiresAt: 0 } : {}),
    })
  })
}
