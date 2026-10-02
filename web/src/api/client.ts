import { createApiClient } from '@stickydo/core/api'

export { ApiError, toApiError, type Problem, type Schemas, type User } from '@stickydo/core/api'

/** API 地址：开发时 Vite 把 /api 代理到 :8080（见 vite.config.ts），部署时可用 VITE_API_BASE 覆盖 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1'

/** 认证中间件由 features/auth/session.ts 加上：请求前带上有效的 Access Token，遇到 401 时刷新一次再重试 */
export const api = createApiClient(API_BASE)
