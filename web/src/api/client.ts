import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from './schema'

export type Schemas = components['schemas']
export type User = Schemas['User']
export type Problem = Schemas['Problem']

/** API 地址：开发时 Vite 把 /api 代理到 :8080（见 vite.config.ts），部署时可用 VITE_API_BASE 覆盖 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1'

/** 接口错误：服务端返回的 problem+json，或网络错误（code = 'network'） */
export class ApiError extends Error {
  readonly status: number
  readonly code: Problem['code'] | 'network'
  readonly fields: Record<string, string>

  constructor(p: { status: number; code: ApiError['code']; title: string; fields?: Record<string, string> }) {
    super(p.title)
    this.status = p.status
    this.code = p.code
    this.fields = p.fields ?? {}
  }

  static network() {
    return new ApiError({ status: 0, code: 'network', title: '连不上服务器，请检查网络后重试' })
  }
}

export function toApiError(error: unknown, response?: Response): ApiError {
  const p = error as Partial<Problem> | undefined
  if (p && typeof p === 'object' && typeof p.code === 'string' && typeof p.title === 'string') {
    return new ApiError({ status: p.status ?? response?.status ?? 0, code: p.code, title: p.title, fields: p.fields })
  }
  if (!response) return ApiError.network()
  return new ApiError({ status: response.status, code: 'internal', title: '服务器出了点问题，请稍后再试' })
}

/**
 * 认证中间件由 features/auth/session.ts 注册（避免循环依赖）：
 * 请求前带上有效的 Access Token，遇到 401 时刷新一次再重试。
 */
export const api = createClient<paths>({ baseUrl: API_BASE })

export function useApiMiddleware(m: Middleware) {
  api.use(m)
}
