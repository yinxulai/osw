export interface PanelViewport {
  width: number
  height: number
}

export interface PanelRect {
  left: number
  top: number
  width: number
  height: number
}

export interface PanelMeasurement {
  left: number
  top: number
  width: number
  height: number
}

export const PANEL_MARGIN = 16
export const PANEL_MIN_WIDTH = 360
export const PANEL_MIN_HEIGHT = 320
export const PANEL_MAX_WIDTH = 1152
export const PANEL_MAX_HEIGHT = 780

function viewportLimit(value: number, margin: number): number {
  return Math.max(0, value - margin * 2)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function sizeBounds(viewport: PanelViewport) {
  return {
    minWidth: Math.min(PANEL_MIN_WIDTH, viewportLimit(viewport.width, PANEL_MARGIN)),
    maxWidth: Math.min(PANEL_MAX_WIDTH, viewportLimit(viewport.width, PANEL_MARGIN)),
    minHeight: Math.min(PANEL_MIN_HEIGHT, viewportLimit(viewport.height, PANEL_MARGIN)),
    maxHeight: Math.min(PANEL_MAX_HEIGHT, viewportLimit(viewport.height, PANEL_MARGIN)),
  }
}

export function readPanelViewport(): PanelViewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Clamp a measured panel rect, falling back to the default rect when layout is unavailable. */
export function measuredPanelRect(measurement: PanelMeasurement | null | undefined, viewport: PanelViewport): PanelRect {
  if (measurement && measurement.width > 0 && measurement.height > 0) {
    return clampPanelRect(measurement, viewport)
  }
  return defaultPanelRect(viewport)
}

/** The initial desktop size mirrors the old CSS size while still fitting narrow viewports. */
export function defaultPanelRect(viewport: PanelViewport): PanelRect {
  const bounds = sizeBounds(viewport)
  const width = bounds.maxWidth
  const height = Math.min(bounds.maxHeight, Math.max(0, Math.round(viewport.height * 0.92)))
  return {
    left: Math.max(PANEL_MARGIN, viewport.width - PANEL_MARGIN - width),
    top: Math.max(PANEL_MARGIN, viewport.height - PANEL_MARGIN - height),
    width,
    height,
  }
}

/** Keep a panel fully inside the usable viewport, including after a window resize. */
export function clampPanelRect(rect: PanelRect, viewport: PanelViewport): PanelRect {
  const bounds = sizeBounds(viewport)
  const width = clamp(rect.width, bounds.minWidth, bounds.maxWidth)
  const height = clamp(rect.height, bounds.minHeight, bounds.maxHeight)
  const maxLeft = Math.max(PANEL_MARGIN, viewport.width - PANEL_MARGIN - width)
  const maxTop = Math.max(PANEL_MARGIN, viewport.height - PANEL_MARGIN - height)
  return {
    left: clamp(rect.left, PANEL_MARGIN, maxLeft),
    top: clamp(rect.top, PANEL_MARGIN, maxTop),
    width,
    height,
  }
}

export function movePanelRect(rect: PanelRect, deltaX: number, deltaY: number, viewport: PanelViewport): PanelRect {
  const maxLeft = Math.max(PANEL_MARGIN, viewport.width - PANEL_MARGIN - rect.width)
  const maxTop = Math.max(PANEL_MARGIN, viewport.height - PANEL_MARGIN - rect.height)
  return {
    ...rect,
    left: clamp(rect.left + deltaX, PANEL_MARGIN, maxLeft),
    top: clamp(rect.top + deltaY, PANEL_MARGIN, maxTop),
  }
}

/** Fill the viewport while preserving the panel margin on every side. */
export function maximizedPanelRect(viewport: PanelViewport): PanelRect {
  return {
    left: PANEL_MARGIN,
    top: PANEL_MARGIN,
    width: Math.max(0, viewport.width - PANEL_MARGIN * 2),
    height: Math.max(0, viewport.height - PANEL_MARGIN * 2),
  }
}
