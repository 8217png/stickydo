import { create } from 'zustand'

/**
 * 白板的缩放（docs/frontend-design.md §2.11）。镜头由 Whiteboard 管，这里只放：
 * - 当前比例 zoom：随手势实时变化，只有右下角的控件订阅；便利贴在被按下时才读取（拖动时按比例换算），
 *   缩放不会让所有便利贴重新渲染
 * - 控件和快捷键调用的操作：由当前白板注册
 */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 2
/** 放大 / 缩小一档时停在这些比例上 */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/** 从 z 往上 / 往下一档 */
export function nextZoomStep(z: number, dir: 1 | -1) {
  const eps = 0.005
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + eps) ?? ZOOM_MAX
  return [...ZOOM_STEPS].reverse().find((s) => s < z - eps) ?? ZOOM_MIN
}

export const useZoom = create<{ zoom: number }>(() => ({ zoom: 1 }))

/**
 * 画布图层此刻在页面上实际的比例（不是 React 状态）：白板改 transform 时同步更新。
 * 便利贴挂载、被按下时读它；换白板时新白板的比例先写进画布再挂载便利贴，两者始终一致
 */
let domZoom = 1
export const canvasZoom = () => domZoom
export const setCanvasZoom = (z: number) => {
  domZoom = z
}

export interface ZoomControls {
  /** 以可见区域中央为中心，放大 / 缩小一档 */
  step: (dir: 1 | -1) => void
  /** 以可见区域中央为中心，缩放到某个比例 */
  zoomTo: (z: number) => void
  /** 缩放并移动到能看到当前白板的所有便利贴 */
  fit: () => void
}

let controls: ZoomControls | null = null
export const setZoomControls = (c: ZoomControls | null) => {
  controls = c
}
export const zoomControls = () => controls

export const formatZoom = (z: number) => `${Math.round(z * 100)}%`
