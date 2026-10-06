// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTrayPanelHeight } from './use-tray-panel-height'

/*
 * 托盘面板「内容决定高度」这条链路的 3 个环节：观察内容、合并同帧回调、把高度报给宿主窗口。
 *
 * 每一条都有它存在的理由，所以每一条都要能被测出来：
 *  - 内容高度变化 → 窗口高度跟着变（不跟就会露一条缝或多一块透明）；
 *  - 同一帧多次回调只报一次（否则贴着鼠标的浮层会抖）；
 *  - 高度没变就不报（多余的 IPC 会让窗口反复重排）。
 */

const state = vi.hoisted(() => ({
  resize: vi.fn<(height: number) => void>(),
  hasResize: true,
  observedDisconnects: 0,
  observers: [] as (() => void)[],
}))

/** 当前面板测得的内容高度，用例自己改。 */
let measuredHeight = 0

class FakeResizeObserver {
  private readonly callback: () => void

  constructor(callback: () => void) {
    this.callback = callback
    state.observers.push(callback)
  }

  observe() {
    // 真的 ResizeObserver 会在 observe 之后尽快派一次回调，这里由用例显式触发。
  }

  disconnect() {
    state.observedDisconnects += 1
  }

  /** 让用例模拟「内容尺寸变了」。 */
  static triggerAll() {
    for (const observer of state.observers) observer()
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  state.resize.mockClear()
  state.hasResize = true
  state.observedDisconnects = 0
  state.observers = []
  measuredHeight = 0

  Object.defineProperty(window, 'trayPanel', {
    value: {
      get resize() {
        return state.hasResize ? state.resize : undefined
      },
    },
    configurable: true,
  })

  // 让 requestAnimationFrame 同步执行：这里要断言的是「报什么」，不是「什么时候报」。
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'trayPanel')
})

function makeRef() {
  const element = {
    getBoundingClientRect: () => ({ height: measuredHeight }) as DOMRect,
  }
  return { current: element as unknown as HTMLElement }
}

describe('useTrayPanelHeight', () => {
  it('挂载时就把初始高度报出去', () => {
    measuredHeight = 320

    renderHook(() => useTrayPanelHeight(makeRef(), 16))

    expect(state.resize).toHaveBeenCalledWith(336)
  })

  it('高度取整向上，避免内容被最后 1 像素切掉', () => {
    measuredHeight = 320.2

    renderHook(() => useTrayPanelHeight(makeRef(), 16))

    expect(state.resize).toHaveBeenCalledWith(337)
  })

  it('留白直接加在内容高度上', () => {
    measuredHeight = 100

    renderHook(() => useTrayPanelHeight(makeRef(), 0))
    renderHook(() => useTrayPanelHeight(makeRef(), 24))

    expect(state.resize).toHaveBeenNthCalledWith(1, 100)
    expect(state.resize).toHaveBeenNthCalledWith(2, 124)
  })

  it('内容尺寸变化后重新上报', () => {
    measuredHeight = 200
    renderHook(() => useTrayPanelHeight(makeRef(), 0))
    expect(state.resize).toHaveBeenCalledTimes(1)

    measuredHeight = 260
    FakeResizeObserver.triggerAll()

    expect(state.resize).toHaveBeenCalledTimes(2)
    expect(state.resize).toHaveBeenLastCalledWith(260)
  })

  it('高度没变就不再上报（省掉一次无意义的窗口重排）', () => {
    measuredHeight = 200
    renderHook(() => useTrayPanelHeight(makeRef(), 0))

    FakeResizeObserver.triggerAll()
    FakeResizeObserver.triggerAll()

    expect(state.resize).toHaveBeenCalledTimes(1)
  })

  it('同一帧里的多次回调合并成一次上报', () => {
    measuredHeight = 200
    // 用真的 rAF 语义（攒到下一帧）而不是同步执行，才测得出「合并」。
    const pending: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.push(callback)
      return pending.length
    })

    renderHook(() => useTrayPanelHeight(makeRef(), 0))
    pending.length = 0
    state.resize.mockClear()

    measuredHeight = 260
    FakeResizeObserver.triggerAll()
    FakeResizeObserver.triggerAll()
    FakeResizeObserver.triggerAll()
    expect(pending).toHaveLength(1)

    pending[0](0)
    expect(state.resize).toHaveBeenCalledTimes(1)
    expect(state.resize).toHaveBeenCalledWith(260)
  })

  it('浏览器形态（没有宿主窗口）下静默跳过', () => {
    state.hasResize = false
    measuredHeight = 320

    renderHook(() => useTrayPanelHeight(makeRef(), 16))

    expect(state.resize).not.toHaveBeenCalled()
  })

  it('还没有挂上 DOM 节点时不动', () => {
    measuredHeight = 320

    renderHook(() => useTrayPanelHeight({ current: null }, 16))

    expect(state.resize).not.toHaveBeenCalled()
  })

  it('卸载时断开观察并取消待执行的那一帧', () => {
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const pending: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.push(callback)
      return pending.length
    })

    const { unmount } = renderHook(() => useTrayPanelHeight(makeRef(), 0))
    FakeResizeObserver.triggerAll()
    expect(pending).toHaveLength(1)

    unmount()

    expect(state.observedDisconnects).toBe(1)
    expect(cancel).toHaveBeenCalledWith(1)
  })

  it('gutter 变化时重新上报', () => {
    measuredHeight = 200
    const ref = makeRef()
    const { rerender } = renderHook(({ gutter }) => useTrayPanelHeight(ref, gutter), {
      initialProps: { gutter: 0 },
    })

    rerender({ gutter: 32 })

    expect(state.resize).toHaveBeenLastCalledWith(232)
  })
})
