// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppearance, useAppearanceUrlSync } from './use-appearance'
import { useAppUiStore } from '@/store/app-ui-store'
import { useLanguageStore } from '@/i18n/store'

// 地址栏的读取走 `useSyncExternalStore` + 真实 history 单例，直接拿真地址当输入没法在单测里
// 逐条改写。所以只替换这一条读口，其余（包括 `appearanceSearch`）都用真实现 ——
// 断言的就是它写出的形状。
const urlOverrides = vi.hoisted(() => ({ current: { lang: null as string | null, theme: null as string | null } }))
vi.mock('@/routing/url-overrides', async importOriginal => ({
  ...(await importOriginal<object>()),
  useUrlOverrides: () => urlOverrides.current,
}))

/** 跳转载荷的形状：只用来让 mock 的调用记录带上参数类型，字段按测试需要用到的部分声明。 */
interface NavigationOptions {
  to: string
  replace: boolean
  search?: (prev: Record<string, unknown>) => Record<string, unknown>
}

// 只替换 `useNavigate`：整体 mock 会把它其余的导出一起抹掉，而这条链上确实要用到它们。
// 返回值必须是 thenable：hook 里都是 `void navigate(...).catch(...)`。
const navigate = vi.hoisted(() => vi.fn(async (_options: NavigationOptions) => undefined))
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}))

/** 取本次跳转的载荷；`search` 是函数，顺手用给定的旧搜索参数展开一次，验证是「追加」而非「覆盖」。 */
const lastNavigation = (previousSearch: Record<string, unknown> = {}) => {
  const options = navigate.mock.calls.at(-1)?.[0] as NavigationOptions
  expect(options.to).toBe('.')
  expect(options.replace).toBe(true)
  return { ...options, search: options.search?.(previousSearch) }
}

describe('useAppearance', () => {
  beforeEach(() => {
    navigate.mockClear()
    urlOverrides.current = { lang: null, theme: null }
    useLanguageStore.setState({ preference: 'system' })
    useAppUiStore.setState({ themeMode: 'system' })
  })

  it('改语言时同时写偏好与地址栏', () => {
    const { result } = renderHook(() => useAppearance())

    act(() => result.current.setLanguage('zh-CN'))

    expect(useLanguageStore.getState().preference).toBe('zh-CN')
    expect(lastNavigation().search).toEqual({ lang: 'zh-CN' })
  })

  it('偏好是「跟随系统」时，地址栏语言落成当下解析出的语种', () => {
    const { result } = renderHook(() => useAppearance())

    act(() => result.current.setLanguage('system'))

    // 地址栏里的语言只能是具体语种，表达不了「跟随系统」，所以这里必须是解析后的值。
    expect(lastNavigation().search).toEqual({ lang: 'en' })
  })

  it('改主题时同时写偏好与地址栏，且不冲掉别的搜索参数', () => {
    const { result } = renderHook(() => useAppearance())

    act(() => result.current.setThemeMode('dark'))

    expect(useAppUiStore.getState().themeMode).toBe('dark')
    // `search` 是整体替换语义：这里必须把 `range` 一起带出来，否则用户正看的时间范围会被抹掉。
    expect(lastNavigation({ range: 'today' }).search).toEqual({ range: 'today', theme: 'dark' })
  })

  it('「跟随系统」原样写进地址栏，它是选择而不是「没有选择」', () => {
    const { result } = renderHook(() => useAppearance())

    act(() => result.current.setThemeMode('system'))

    expect(lastNavigation().search).toEqual({ theme: 'system' })
  })

  it('偏好是「跟随系统」时屏幕按系统亮暗渲染，开关则落成具体主题', () => {
    const { result } = renderHook(() => useAppearance())

    // 测试环境的 `matchMedia` 固定报「不匹配」，系统即浅色。
    expect(result.current.theme).toBe('light')

    act(() => result.current.toggleTheme())

    expect(useAppUiStore.getState().themeMode).toBe('dark')
    expect(lastNavigation().search).toEqual({ theme: 'dark' })
  })

  it('地址栏里的值就是生效值，压过持久化偏好', () => {
    urlOverrides.current = { lang: 'zh-CN', theme: 'dark' }
    useLanguageStore.setState({ preference: 'en' })
    useAppUiStore.setState({ themeMode: 'light' })

    const { result } = renderHook(() => useAppearance())

    expect(result.current.locale).toBe('zh-CN')
    expect(result.current.theme).toBe('dark')
  })
})

describe('useAppearanceUrlSync', () => {
  beforeEach(() => {
    navigate.mockClear()
    urlOverrides.current = { lang: null, theme: null }
    useLanguageStore.setState({ preference: 'en' })
    useAppUiStore.setState({ themeMode: 'dark' })
  })

  it('地址栏缺两项时一次补全，语言与主题都写上去', () => {
    renderHook(() => useAppearanceUrlSync())

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(lastNavigation().search).toEqual({ lang: 'en', theme: 'dark' })
  })

  it('两项都在地址栏里时不再跳转', () => {
    urlOverrides.current = { lang: 'zh-CN', theme: 'light' }

    renderHook(() => useAppearanceUrlSync())

    expect(navigate).not.toHaveBeenCalled()
  })

  it('只缺语言时不去动已有的主题', () => {
    urlOverrides.current = { lang: null, theme: 'light' }

    renderHook(() => useAppearanceUrlSync())

    expect(lastNavigation().search).toEqual({ lang: 'en' })
  })

  it('只缺主题时补上偏好里的选择，不碰语言', () => {
    urlOverrides.current = { lang: 'zh-CN', theme: null }

    renderHook(() => useAppearanceUrlSync())

    expect(lastNavigation({ range: 'today' }).search).toEqual({ range: 'today', theme: 'dark' })
  })

  it('偏好是「跟随系统」时也把 system 写进地址栏', () => {
    useAppUiStore.setState({ themeMode: 'system' })

    renderHook(() => useAppearanceUrlSync())

    expect(lastNavigation().search).toEqual({ lang: 'en', theme: 'system' })
  })
})
