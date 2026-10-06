// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsMobile } from './use-mobile'

/*
 * 断点 768：判据是 `window.innerWidth < 768`，而真正会变的那条路是 `matchMedia` 的
 * `change` 事件。两侧都要验：初值靠挂载时读一次宽度，之后靠订阅回调。
 *
 * 全局 setup 里的 `matchMedia` shim 只是「永远不匹配」的静态替身，收不到事件；
 * 这里换一个能派发 `change` 的替身，才走得到真实的订阅回调。
 */

interface FakeMediaQueryList {
  matches: boolean
  media: string
  listeners: Set<() => void>
  emit: () => void
}

const media = vi.hoisted(() => ({ current: null as FakeMediaQueryList | null }))

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

beforeEach(() => {
  setWidth(1024)
  window.matchMedia = ((query: string) => {
    const listeners = new Set<() => void>()
    const list: FakeMediaQueryList = {
      matches: false,
      media: query,
      listeners,
      emit: () => listeners.forEach(listener => listener()),
    }
    const target = list as unknown as MediaQueryList & { addEventListener: (event: string, listener: () => void) => void; removeEventListener: (event: string, listener: () => void) => void }
    target.addEventListener = (_event, listener) => void listeners.add(listener)
    target.removeEventListener = (_event, listener) => void listeners.delete(listener)
    media.current = list
    return target
  }) as typeof window.matchMedia
})

afterEach(() => {
  setWidth(1024)
})

describe('useIsMobile', () => {
  it('查询串是 767：断点 768 本身不算窄', () => {
    renderHook(() => useIsMobile())
    expect(media.current?.media).toBe('(max-width: 767px)')
  })

  it('宽屏下是 false', () => {
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('窄屏下挂载时就是 true', () => {
    setWidth(480)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('断点上：768 是宽，767 是窄', () => {
    setWidth(768)
    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
    setWidth(767)
    expect(renderHook(() => useIsMobile()).result.current).toBe(true)
  })

  it('窗口变窄之后收到 change 事件就翻成 true', () => {
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      setWidth(600)
      media.current?.emit()
    })
    expect(result.current).toBe(true)
  })

  it('`emit` 按监听表派发：订阅了才叫得到', () => {
    renderHook(() => useIsMobile())
    expect(media.current?.listeners.size).toBe(1)
  })

  it('卸载时摘掉监听：卸载之后再来的 change 不该落到已经没了的组件上', () => {
    const { unmount } = renderHook(() => useIsMobile())
    expect(media.current?.listeners.size).toBe(1)

    unmount()

    expect(media.current?.listeners.size).toBe(0)
  })
})
