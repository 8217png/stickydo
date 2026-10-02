import createClient, { type Client } from 'openapi-fetch'
import type { components, paths } from './schema'

export type { components, paths }
export type Schemas = components['schemas']
export type User = Schemas['User']
export type Problem = Schemas['Problem']
export type ApiClient = Client<paths>

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
 * 创建 API 客户端。baseUrl 例如 Web 的 /api/v1（同源）或移动端的 https://<服务器>/api/v1。
 * 认证由 createSession（../auth/session.ts）以中间件的形式加上。
 */
export function createApiClient(baseUrl: string): ApiClient {
  return createClient<paths>({ baseUrl })
}
