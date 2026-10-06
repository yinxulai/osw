// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useIsMobile } from './use-mobile'

/*
 * 断点 768：判据是 `window.innerWidth < 768`，而真正会变的那条路是 `matchMedia` 的
 * `change` 事件。两侧都要验：初值靠挂载时读一次宽度，之后靠订阅回调。
 *
 * 全局 setup 里的 `matchMedia` shim 只是「永远不匹配」的静态替身，收不到事件；
 * 这里换一个能派发 `change` 的替身，才走得到真实的订阅回调。
 *
 * 替身直接实现 `MediaQueryList`（而不是只摆出用得到的几个字段再强转）：它多出来的
 * `listeners` / `emit` 是给用例观察和派发用的，剩下七个成员一律照 DOM 的真实签名写，
 * 于是 `window.matchMedia` 拿到的就是一个货真价实的 `MediaQueryList`。
 */

/** 真实 `addEventListener('change', …)` 回调的形状；生产代码传的零参函数也属于它。 */
type ChangeListener = (event: Event) => void

interface FakeMediaQueryList extends MediaQueryList {
  readonly listeners: Set<ChangeListener>
  readonly emit: () => void
}

/** `media.current` 指向当前这次 `matchMedia()` 造出来的替身。 */
let media: { current: FakeMediaQueryList | null } = { current: null }

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function createMediaQueryList(query: string): FakeMediaQueryList {
  const listeners = new Set<ChangeListener>()
  const emit = (): void => {
    // 真实事件会带一个 `MediaQueryListEvent`；用例只关心「回调被叫到了」。
    for (const listener of listeners) listener(new Event('change'))
  }
  return {
    matches: false,
    media: query,
    onchange: null,
    // 两个老接口已被 DOM 标成废弃，但仍是 `MediaQueryList` 的成员，摆上空实现即可。
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void => {
      if (!listener) return
      listeners.add(typeof listener === 'function' ? listener : event => listener.handleEvent(event))
      void type
      void options
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null): void => {
      if (typeof listener === 'function') listeners.delete(listener)
      void type
    },
    dispatchEvent: (): boolean => {
      emit()
      return true
    },
    listeners,
    emit,
  }
}

beforeEach(() => {
  setWidth(1024)
  window.matchMedia = (query: string) => {
    const list = createMediaQueryList(query)
    media.current = list
    return list
  }
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
