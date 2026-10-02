import { load, save } from '../lib/storage'

/**
 * 插件的独立窗口：普通的 Chrome 弹出式窗口，可以自由拖边调整大小，
 * 不受浮窗 800×600 的限制。窗口的大小和位置会被记住。
 */
interface Bounds {
  width: number
  height: number
  left?: number
  top?: number
}

const BOUNDS_KEY = 'stickydo.ext.windowBounds'
const ID_KEY = 'stickydo.ext.windowId'
const DEFAULT_BOUNDS: Bounds = { width: 960, height: 720 }

/**
 * 从浮窗打开独立窗口；已经开着就切过去。随后关闭浮窗。
 * route：打开到某一页，例如 '/login'（浮窗一失去焦点就会关闭，登录这类需要授权弹窗的操作放到独立窗口里做）
 */
export async function openStandaloneWindow(route?: string) {
  const url = chrome.runtime.getURL(`popup.html?window=1${route ? `#${route}` : ''}`)
  const id = load<number>(ID_KEY)
  if (id != null) {
    try {
      await chrome.windows.update(id, { focused: true })
      if (route) {
        const [tab] = await chrome.tabs.query({ windowId: id })
        if (tab?.id != null) await chrome.tabs.update(tab.id, { url })
      }
      window.close()
      return
    } catch {
      // 窗口已经关掉了，重新打开
    }
  }
  const b = load<Bounds>(BOUNDS_KEY) ?? DEFAULT_BOUNDS
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    focused: true,
    width: Math.max(360, b.width),
    height: Math.max(400, b.height),
    ...(b.left != null && b.top != null ? { left: b.left, top: b.top } : {}),
  })
  if (win?.id != null) save(ID_KEY, win.id)
  window.close()
}

/** 在独立窗口里调用：记住窗口的大小和位置 */
export async function trackStandaloneWindowBounds() {
  const me = await chrome.windows.getCurrent()
  if (me.id == null) return
  save(ID_KEY, me.id)
  const remember = (w: chrome.windows.Window) => {
    if (w.width && w.height) save(BOUNDS_KEY, { width: w.width, height: w.height, left: w.left, top: w.top })
  }
  remember(me)
  chrome.windows.onBoundsChanged.addListener((w) => {
    if (w.id === me.id) remember(w)
  })
}
