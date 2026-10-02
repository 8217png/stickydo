import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, toApiError, type ApiClient, type Schemas, type User } from '../api/client'

/**
 * 登录状态（docs/architecture.md §2、§6：基于 Token，不依赖 Cookie）
 * - Refresh Token 与用户信息交给各端的存储（Web 用 localStorage，移动端用安全存储）
 * - Access Token 只放内存，启动后第一次请求时用 Refresh Token 换取
 * - 请求前带上有效的 Access Token；遇到 401 时刷新一次再重试
 */

/** 各端保存的登录信息 */
export interface StoredSession {
  user: User
  deviceId: string
  refreshToken: string
  refreshExpiresAt: string
}

/** 登录信息的存取，由各端实现（可以是同步的，也可以是异步的） */
export interface SessionStorage {
  load(): StoredSession | null | Promise<StoredSession | null>
  save(s: StoredSession): void | Promise<void>
  clear(): void | Promise<void>
}

export interface SessionState {
  user: User | null
  deviceId: string | null
  refreshToken: string | null
  accessToken: string | null
  accessExpiresAt: number

  login: (email: string, password: string) => Promise<User>
  register: (email: string, password: string, name?: string) => Promise<User>
  logout: () => Promise<void>
  /** 用服务端的最新信息更新当前用户（例如启动后） */
  reloadUser: () => Promise<void>
}

export interface SessionOptions {
  api: ApiClient
  storage: SessionStorage
  /** 登录时上报的设备信息 */
  device: () => Schemas['DeviceInfo']
  /** 能同步读到的已保存登录信息（Web 从 localStorage 读），避免启动时闪一下“未登录” */
  initial?: StoredSession | null
}

export interface Session {
  store: StoreApi<SessionState>
  /** 换一个新的 Access Token；同一时间只发一个刷新请求。失败（会话失效）时退出登录并返回 null。 */
  refreshAccessToken: () => Promise<string | null>
  /** 从存储读取登录信息（存储是异步的端在启动时调用） */
  restore: () => Promise<void>
  /** 登录信息在别处被修改了（例如另一个标签页登录、退出或刷新了令牌） */
  adoptStored: (next: StoredSession | null) => void
}

/** Access Token 剩余不到这么久就提前刷新 */
const EXPIRY_SKEW_MS = 30_000
const PUBLIC = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/healthz'])

export function createSession({ api, storage, device, initial }: SessionOptions): Session {
  let refreshExpiresAt = initial?.refreshExpiresAt ?? ''

  const store = createStore<SessionState>()((set, get) => ({
    user: initial?.user ?? null,
    deviceId: initial?.deviceId ?? null,
    refreshToken: initial?.refreshToken ?? null,
    accessToken: null,
    accessExpiresAt: 0,

    login: async (email, password) => {
      const { data, error, response } = await api.POST('/auth/login', {
        body: { email, password, device: device() },
      })
      if (!data) throw toApiError(error, response)
      adopt(data)
      return data.user
    },

    register: async (email, password, name) => {
      const { data, error, response } = await api.POST('/auth/register', {
        body: { email, password, name: name || undefined, device: device() },
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
    store.setState({
      user: res.user,
      deviceId: res.device_id,
      refreshToken: res.tokens.refresh_token,
      accessToken: res.tokens.access_token,
      accessExpiresAt: Date.parse(res.tokens.access_expires_at),
    })
    persist(res.tokens.refresh_expires_at)
  }

  function persist(expiresAt?: string) {
    const s = store.getState()
    if (!s.user || !s.deviceId || !s.refreshToken) return
    if (expiresAt) refreshExpiresAt = expiresAt
    void storage.save({ user: s.user, deviceId: s.deviceId, refreshToken: s.refreshToken, refreshExpiresAt })
  }

  function clear() {
    store.setState({ user: null, deviceId: null, refreshToken: null, accessToken: null, accessExpiresAt: 0 })
    refreshExpiresAt = ''
    void storage.clear()
  }

  // ---------- 刷新令牌 ----------

  let inflight: Promise<string | null> | null = null

  function refreshAccessToken(): Promise<string | null> {
    inflight ??= doRefresh().finally(() => (inflight = null))
    return inflight
  }

  async function doRefresh(retried = false): Promise<string | null> {
    const token = store.getState().refreshToken
    if (!token) return null
    const res = await api.POST('/auth/refresh', { body: { refresh_token: token } }).catch(() => {
      throw ApiError.network()
    })
    if (res.data) {
      store.setState({
        refreshToken: res.data.refresh_token,
        accessToken: res.data.access_token,
        accessExpiresAt: Date.parse(res.data.access_expires_at),
      })
      persist(res.data.refresh_expires_at)
      return res.data.access_token
    }
    if (res.response.status === 401) {
      // 另一个标签页可能刚刚刷新过：读一下存储里有没有更新的 Refresh Token
      const latest = (await storage.load())?.refreshToken
      if (!retried && latest && latest !== token) {
        store.setState({ refreshToken: latest })
        return doRefresh(true)
      }
      clear()
      return null
    }
    throw toApiError(res.error, res.response)
  }

  async function validAccessToken(): Promise<string | null> {
    const s = store.getState()
    if (!s.refreshToken) return null
    if (s.accessToken && s.accessExpiresAt - Date.now() > EXPIRY_SKEW_MS) return s.accessToken
    return refreshAccessToken()
  }

  // ---------- 请求中间件 ----------

  const retryable = new Map<string, Request>()

  api.use({
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
      if (!store.getState().refreshToken) return
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

  // ---------- 外部变化 ----------

  function adoptStored(next: StoredSession | null) {
    if (!next) {
      store.setState({ user: null, deviceId: null, refreshToken: null, accessToken: null, accessExpiresAt: 0 })
      refreshExpiresAt = ''
      return
    }
    const cur = store.getState()
    refreshExpiresAt = next.refreshExpiresAt
    store.setState({
      user: next.user,
      deviceId: next.deviceId,
      refreshToken: next.refreshToken,
      // 换了账号或令牌：作废内存里的 Access Token，下次请求时重新获取
      ...(cur.refreshToken !== next.refreshToken ? { accessToken: null, accessExpiresAt: 0 } : {}),
    })
  }

  async function restore() {
    if (store.getState().refreshToken) return
    const saved = await storage.load()
    if (saved && !store.getState().refreshToken) adoptStored(saved)
  }

  return { store, refreshAccessToken, restore, adoptStored }
}
