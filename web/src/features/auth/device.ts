import type { Schemas } from '../../api/client'
import { surface } from '../../extension/surface'

/** 登录时上报的设备信息，显示在“已登录设备”列表里，例如 “Chrome · macOS” */
export function currentDevice(): Schemas['DeviceInfo'] {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '浏览器'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  const name = surface === 'web' ? [browser, os].filter(Boolean).join(' · ') : `${browser} 插件`
  return { name, platform: surface === 'web' ? 'web' : 'extension' }
}
