import { describe, expect, it } from 'vitest'
import { clampZoom, formatZoom, nextZoomStep, ZOOM_MAX, ZOOM_MIN } from './zoom'

describe('nextZoomStep', () => {
  it('停在预设的比例上', () => {
    expect(nextZoomStep(1, 1)).toBe(1.1)
    expect(nextZoomStep(1, -1)).toBe(0.9)
    expect(nextZoomStep(0.8, 1)).toBe(0.9)
    expect(nextZoomStep(0.8, -1)).toBe(0.75)
  })
  it('非常接近某一档时跳到下一档，不会原地不动', () => {
    expect(nextZoomStep(1.0999, 1)).toBe(1.25)
    expect(nextZoomStep(0.5004, -1)).toBe(0.33)
  })
  it('不超出范围', () => {
    expect(nextZoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(nextZoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
})

describe('clampZoom / formatZoom', () => {
  it('限制在 25%–200%', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(5)).toBe(ZOOM_MAX)
    expect(clampZoom(1.3)).toBe(1.3)
  })
  it('显示成百分比', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.333)).toBe('33%')
  })
})
