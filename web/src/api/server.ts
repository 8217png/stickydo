import { load, save } from '../lib/storage'
import { normalizeServer } from '@stickydo/core/api'
import { isExtension } from '../extension/surface'

export { normalizeServer }

/**
 * 服务器地址（E2）：网页版与服务端同源，用相对路径 /api/v1；
 * Chrome 插件运行在 chrome-extension:// 下，需要知道连哪台服务器——登录时填写并记住，
 * 构建时可以用 VITE_DEFAULT_SERVER 指定默认值（例如自己部署的 https://notes.example.com）。
 */

const KEY = 'stickydo.server'
const DEFAULT_SERVER = normalizeServer(import.meta.env.VITE_DEFAULT_SERVER ?? '') ?? ''

/** 插件当前使用的服务器（origin）；网页版为 null（同源） */
export function serverOrigin(): string | null {
  if (!isExtension) return null
  return load<string>(KEY) || DEFAULT_SERVER || null
}

export function setServerOrigin(origin: string) {
  save(KEY, origin)
}

/** 插件里登录 / 注册前：申请访问这台服务器的权限（manifest 的 optional_host_permissions） */
export async function requestServerPermission(origin: string): Promise<boolean> {
  if (!isExtension || typeof chrome === 'undefined' || !chrome.permissions) return true
  try {
    return await chrome.permissions.request({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}

/** 是否已有访问这台服务器的权限 */
export async function hasServerPermission(origin: string): Promise<boolean> {
  if (!isExtension || typeof chrome === 'undefined' || !chrome.permissions) return true
  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}
