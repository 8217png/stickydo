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
 * fetch：自定义发送请求（例如 Chrome 插件的服务器地址可以在运行时更改）。
 */
export function createApiClient(baseUrl: string, opts: { fetch?: (req: Request) => Promise<Response> } = {}): ApiClient {
  return createClient<paths>({ baseUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
}

/** 服务器地址规范成 origin（插件、移动端填写服务器时用）：补上 https://，去掉路径和末尾的斜杠；不像网址时返回 null */
export function normalizeServer(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname) return null
    return u.origin
  } catch {
    return null
  }
}

