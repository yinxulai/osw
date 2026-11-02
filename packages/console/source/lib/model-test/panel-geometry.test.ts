import { describe, expect, it } from 'vitest'
import {
  PANEL_MARGIN,
  PANEL_MAX_HEIGHT,
  PANEL_MAX_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clampPanelRect,
  defaultPanelRect,
  measuredPanelRect,
  movePanelRect,
  resizePanelRect,
} from './panel-geometry'

describe('model-test panel geometry', () => {
  const desktop = { width: 1440, height: 900 }

  it('starts at the lower-right with the existing maximum dimensions', () => {
    expect(defaultPanelRect(desktop)).toEqual({
      left: desktop.width - PANEL_MARGIN - PANEL_MAX_WIDTH,
      top: desktop.height - PANEL_MARGIN - Math.min(PANEL_MAX_HEIGHT, Math.round(desktop.height * 0.92)),
      width: PANEL_MAX_WIDTH,
      height: PANEL_MAX_HEIGHT,
    })
  })

  it('clamps dragged positions so every edge stays within the viewport margin', () => {
    const rect = { left: 400, top: 300, width: 500, height: 400 }
    expect(movePanelRect(rect, -10_000, -10_000, desktop)).toMatchObject({ left: PANEL_MARGIN, top: PANEL_MARGIN })
    expect(movePanelRect(rect, 10_000, 10_000, desktop)).toMatchObject({
      left: desktop.width - PANEL_MARGIN - rect.width,
      top: desktop.height - PANEL_MARGIN - rect.height,
    })
  })

  it('clamps dimensions to minimum and maximum sizes', () => {
    const rect = { left: 100, top: 100, width: 500, height: 400 }
    expect(resizePanelRect(rect, -10_000, -10_000, desktop)).toMatchObject({ width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT })
    expect(resizePanelRect(rect, 10_000, 10_000, desktop)).toMatchObject({ width: PANEL_MAX_WIDTH, height: PANEL_MAX_HEIGHT })
  })

  it('uses the available viewport as the effective minimum on narrow screens', () => {
    const viewport = { width: 320, height: 280 }
    const rect = defaultPanelRect(viewport)
    expect(rect.width).toBe(viewport.width - PANEL_MARGIN * 2)
    expect(rect.height).toBe(viewport.height - PANEL_MARGIN * 2)
    expect(clampPanelRect({ left: -100, top: -100, width: 900, height: 900 }, viewport)).toEqual(rect)
  })

  it('keeps a resize anchored at the top-left when the viewport shrinks', () => {
    const rect = { left: 100, top: 80, width: 900, height: 700 }
    const viewport = { width: 700, height: 500 }
    const resized = resizePanelRect(rect, 100, 100, viewport)
    expect(resized.left).toBe(rect.left)
    expect(resized.top).toBe(rect.top)
    expect(resized.width).toBe(viewport.width - PANEL_MARGIN - rect.left)
    expect(resized.height).toBe(viewport.height - PANEL_MARGIN - rect.top)
  })

  it('measures the rendered panel and clamps it, falling back when layout is unavailable', () => {
    const measurement = (left: number, top: number, width: number, height: number) => ({ left, top, width, height })

    expect(measuredPanelRect(measurement(100, 80, 500, 400), desktop)).toEqual({ left: 100, top: 80, width: 500, height: 400 })
    expect(measuredPanelRect(measurement(-100, -100, 600, 500), desktop)).toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN, width: 600, height: 500 })
    expect(measuredPanelRect(measurement(0, 0, 0, 0), desktop)).toEqual(defaultPanelRect(desktop))
    expect(measuredPanelRect(null, desktop)).toEqual(defaultPanelRect(desktop))
  })
})

it('exports stable geometry constants for callers and tests', () => {
  expect(PANEL_MIN_WIDTH).toBeLessThan(PANEL_MAX_WIDTH)
  expect(PANEL_MIN_HEIGHT).toBeLessThan(PANEL_MAX_HEIGHT)
})
