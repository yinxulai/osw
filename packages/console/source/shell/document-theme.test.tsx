// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentTheme } from '@/shell/document-theme'

/*
 * 主题副作用：把生效主题画到 `<html>` 上。
 *
 * 主窗口与托盘面板是两个 HTML 入口，但「哪个主题」只有一份真相；这个 hook 是它们
 * 共同的落点。用例守的就是「类名跟着主题走，而且**删掉**另一档」——只加不删的话，
 * 从暗切回亮时 `<html>` 会同时带 `dark` 与亮色变量，页面会花。
 */

const appearance = { theme: 'light' as 'light' | 'dark' }

vi.mock('@/hooks/use-appearance', () => ({
  useResolvedAppearance: () => ({
    language: 'zh-CN',
    themeMode: appearance.theme,
    effectiveThemeMode: appearance.theme,
    locale: 'zh-CN',
    theme: appearance.theme,
  }),
}))

function setTheme(theme: 'light' | 'dark') {
  appearance.theme = theme
}

beforeEach(() => {
  setTheme('light')
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('把主题落到 <html> 上', () => {
  it('亮色时 <html> 上没有 dark 类', () => {
    renderHook(() => useDocumentTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('暗色时加上 dark 类', () => {
    setTheme('dark')
    renderHook(() => useDocumentTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('从暗切回亮时把 dark 类删掉（只加不删会让页面同时带两套变量）', () => {
    setTheme('dark')
    const { rerender } = renderHook(() => useDocumentTheme())
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    setTheme('light')
    rerender()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('亮切暗同样生效（两个方向走同一段代码）', () => {
    const { rerender } = renderHook(() => useDocumentTheme())
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    setTheme('dark')
    rerender()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('主题不变时不重复写类名（effect 依赖是主题本身）', () => {
    const toggle = vi.spyOn(document.documentElement.classList, 'toggle')

    const { rerender } = renderHook(() => useDocumentTheme())
    expect(toggle).toHaveBeenCalledTimes(1)

    rerender()

    // 主题没变，effect 不重跑，也就不用再写一次同样的类名。
    expect(toggle).toHaveBeenCalledTimes(1)

    toggle.mockRestore()
  })

  it('返回值就是生效主题（调用方接着用它告知宿主）', () => {
    setTheme('dark')
    const { result } = renderHook(() => useDocumentTheme())

    expect(result.current).toBe('dark')
  })

  it('卸载时不清掉类名（主题是全局状态，不随某个组件消失）', () => {
    setTheme('dark')
    const { unmount } = renderHook(() => useDocumentTheme())

    unmount()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
