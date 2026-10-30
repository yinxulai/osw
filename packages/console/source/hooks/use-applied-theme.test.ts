// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetAppliedThemeStore, useAppliedTheme } from './use-applied-theme'

/*
 * 「生效主题」的共享外部存储。
 *
 * 过去每个品牌图标各建一个 `MutationObserver`；现在收敛成一个模块级单例，组件只用
 * `useSyncExternalStore` 接进去。用例守的是「跟着 `<html class="dark">` 翻转，且多个
 * 订阅方共享同一个 observer」。
 */

beforeEach(() => {
  document.documentElement.classList.remove('dark')
  __resetAppliedThemeStore()
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
  __resetAppliedThemeStore()
})

describe('useAppliedTheme', () => {
  it('reads the initial applied theme from the document', () => {
    document.documentElement.classList.add('dark')
    __resetAppliedThemeStore()
    const { result } = renderHook(() => useAppliedTheme())
    expect(result.current).toBe('dark')
  })

  it('tracks the dark class flipping on <html>', async () => {
    const { result } = renderHook(() => useAppliedTheme())
    expect(result.current).toBe('light')

    await act(async () => {
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })
    expect(result.current).toBe('dark')

    await act(async () => {
      document.documentElement.classList.remove('dark')
      await Promise.resolve()
    })
    expect(result.current).toBe('light')
  })

  it('keeps all subscribers on a single shared observer', async () => {
    const first = renderHook(() => useAppliedTheme())
    const second = renderHook(() => useAppliedTheme())

    await act(async () => {
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })
    expect(first.result.current).toBe('dark')
    expect(second.result.current).toBe('dark')

    // 卸载其中一个订阅方后，另一个仍然收到更新（observer 不该被提前拆掉）。
    first.unmount()
    await act(async () => {
      document.documentElement.classList.remove('dark')
      await Promise.resolve()
    })
    expect(second.result.current).toBe('light')
  })
})
