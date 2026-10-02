import { createApiClient } from '@stickydo/core/api'
import { isExtension } from '../extension/surface'
import { serverOrigin } from './server'

export { ApiError, toApiError, type Problem, type Schemas, type User } from '@stickydo/core/api'

/** API 地址：开发时 Vite 把 /api 代理到 :8080（见 vite.config.ts），部署时可用 VITE_API_BASE 覆盖 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1'

/**
 * 插件的服务器地址可以在运行时更改（见 server.ts）：请求先发往一个占位地址，发送时换成当前服务器。
 * 插件页面有这台服务器的访问权限，跨域请求不受 CORS 限制。
 */
const EXT_PLACEHOLDER = 'https://stickydo.invalid/api/v1'

/** 当前 API 的完整地址（实时通知用） */
export function apiBase(): string {
  if (!isExtension) return new URL(API_BASE, location.href).href.replace(/\/$/, '')
  return `${serverOrigin() ?? 'https://stickydo.invalid'}/api/v1`
}

const extensionFetch = async (req: Request) => {
  const origin = serverOrigin()
  if (!origin) throw new TypeError('还没有设置服务器地址')
  // 按字段复制，不用 new Request(url, req)：后者在插件页面里发 POST 会直接失败
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return fetch(req.url.replace(EXT_PLACEHOLDER, `${origin}/api/v1`), {
    method: req.method,
    headers: req.headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    signal: req.signal,
    credentials: 'omit',
  })
}

/** 认证中间件由 features/auth/session.ts 加上：请求前带上有效的 Access Token，遇到 401 时刷新一次再重试 */
export const api = isExtension ? createApiClient(EXT_PLACEHOLDER, { fetch: extensionFetch }) : createApiClient(API_BASE)
