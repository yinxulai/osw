// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 形态与全屏状态各由一处决定，这里把两个来源都换成可摆布的开关：hook 要做的只是
// 「读出来 + 交给判据」，真实取值从哪来不该在用例里再演一遍。
const state = vi.hoisted(() => ({
  name: 'web' as 'electron' | 'web',
  os: 'unknown' as 'darwin' | 'win32' | 'linux' | 'unknown',
  fullScreen: false,
}))

vi.mock('@/platform/capabilities', () => ({
  getPlatformCapabilities: () => ({ name: state.name, os: state.os }),
}))
vi.mock('./use-window-full-screen', () => ({
  useWindowFullScreen: () => state.fullScreen,
}))

import { useWindowControlsOverlay } from './use-window-controls-overlay'

function current(): boolean {
  return renderHook(() => useWindowControlsOverlay()).result.current
}

describe('useWindowControlsOverlay', () => {
  beforeEach(() => {
    state.name = 'web'
    state.os = 'unknown'
    state.fullScreen = false
  })

  it('Electron 窗口态下跟着操作系统走', () => {
    state.name = 'electron'

    state.os = 'win32'
    expect(current()).toBe(true)

    state.os = 'darwin'
    expect(current()).toBe(false)
  })

  // 进出全屏时系统控件会隐藏 / 归位，预留的那块地要立刻还回去，所以不能只在挂载时算一次。
  it('跟着全屏状态实时变', () => {
    state.name = 'electron'
    state.os = 'win32'

    state.fullScreen = true
    expect(current()).toBe(false)

    state.fullScreen = false
    expect(current()).toBe(true)
  })

  it('浏览器形态不避让', () => {
    state.name = 'web'
    state.os = 'win32'
    expect(current()).toBe(false)
  })
})
