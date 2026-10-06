import { describe, expect, it } from 'vitest'
import { hasWindowControlsOverlay } from './window-controls'

describe('hasWindowControlsOverlay', () => {
  it('Electron + Windows / Linux 的窗口态：控件压在右上角，要避让', () => {
    expect(hasWindowControlsOverlay({ platform: 'electron', os: 'win32', fullScreen: false })).toBe(true)
    expect(hasWindowControlsOverlay({ platform: 'electron', os: 'linux', fullScreen: false })).toBe(true)
  })

  it('原生全屏下系统控件隐藏，右上角还给渲染层', () => {
    expect(hasWindowControlsOverlay({ platform: 'electron', os: 'win32', fullScreen: true })).toBe(false)
    expect(hasWindowControlsOverlay({ platform: 'electron', os: 'linux', fullScreen: true })).toBe(false)
  })

  it('macOS 走 hiddenInset，红绿灯在左上角且不占渲染层的地盘', () => {
    expect(hasWindowControlsOverlay({ platform: 'electron', os: 'darwin', fullScreen: false })).toBe(false)
  })

  // 浏览器形态的 `os` 是按 UA 猜出来的（见 `capabilities.ts`）：猜中 `win32` 也不代表真有一个
  // 原生标题栏，所以只有 Electron 形态才避让。
  it('浏览器形态一律不避让，哪怕 UA 猜成了 Windows', () => {
    expect(hasWindowControlsOverlay({ platform: 'web', os: 'win32', fullScreen: false })).toBe(false)
    expect(hasWindowControlsOverlay({ platform: 'web', os: 'linux', fullScreen: false })).toBe(false)
  })

  it('认不出的操作系统不猜', () => {
    expect(hasWindowControlsOverlay({ platform: 'electron', os: 'unknown', fullScreen: false })).toBe(false)
  })
})
