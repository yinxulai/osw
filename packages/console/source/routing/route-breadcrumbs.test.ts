// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLanguageStore } from '@/i18n/store'
import { appNavigationItems } from './navigation'
import { navigationBreadcrumb, routeBreadcrumbMetadata, useRouteBreadcrumbs } from './route-breadcrumbs'
import { routePaths } from './routes'

/*
 * 面包屑：**路由是层级的唯一来源**，子页面不能重新定义父级叫什么。
 *
 * 所以这里测的第一件事就是「元数据必须来自侧栏那张表」——`navigationBreadcrumb('x')`
 * 在侧栏里找不到就抛错，而不是悄悄产出一个没有父级的面包屑。
 */

const matches = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock('@tanstack/react-router', () => ({ useMatches: () => matches.value }))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t, useLocale: () => 'zh-CN' }
})

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
  matches.value = []
})

describe('navigationBreadcrumb', () => {
  it('复用侧栏的层级文案，子页面不再自己写父级名字', () => {
    const data = navigationBreadcrumb(routePaths.requestLogs)
    const item = appNavigationItems.find(candidate => candidate.to === routePaths.requestLogs)

    expect(data.breadcrumb?.labelKey).toBe(item?.labelKey)
    expect(data.breadcrumb?.to).toBe(routePaths.requestLogs)
  })

  it('侧栏里没有这一页时直接抛错（不允许出现没有父级的面包屑）', () => {
    expect(() => navigationBreadcrumb('/not-a-page' as never)).toThrow(/Missing navigation item/)
  })

  it('下钻页没有侧栏入口，所以不能拿它做面包屑', () => {
    expect(() => navigationBreadcrumb(routePaths.overviewProvider)).toThrow()
  })
})

describe('routeBreadcrumbMetadata', () => {
  it('取出 staticData 里的 breadcrumb', () => {
    const meta = { labelKey: 'nav.page.logs' as const, to: routePaths.logs }
    expect(routeBreadcrumbMetadata({ breadcrumb: meta })).toEqual(meta)
  })

  it('没有元数据时返回 undefined（不是每一层路由都要出现在面包屑里）', () => {
    expect(routeBreadcrumbMetadata({})).toBeUndefined()
    expect(routeBreadcrumbMetadata({ breadcrumb: undefined })).toBeUndefined()
  })

  it('staticData 是 null / 非对象时安全返回', () => {
    expect(routeBreadcrumbMetadata(null)).toBeUndefined()
    expect(routeBreadcrumbMetadata(undefined)).toBeUndefined()
    expect(routeBreadcrumbMetadata('oops')).toBeUndefined()
    expect(routeBreadcrumbMetadata(42)).toBeUndefined()
  })
})

describe('useRouteBreadcrumbs', () => {
  it('按匹配顺序把有元数据的层挑出来，并翻译成当前语言', () => {
    matches.value = [
      { staticData: undefined },
      { staticData: { breadcrumb: { labelKey: 'nav.page.overview', to: routePaths.overview } } },
      { staticData: { breadcrumb: { labelKey: 'nav.page.requests', to: routePaths.requestLogs } } },
    ]

    const { result } = renderHook(() => useRouteBreadcrumbs())

    expect(result.current.map(item => item.label)).toEqual(['统计分析', '请求日志'])
    expect(result.current.map(item => item.to)).toEqual([routePaths.overview, routePaths.requestLogs])
  })

  it('一层都没有时是空数组，而不是 undefined', () => {
    const { result } = renderHook(() => useRouteBreadcrumbs())
    expect(result.current).toEqual([])
  })

  it('matches 没变时返回同一份结果（useMemo 缓存，避免每帧新建数组）', () => {
    matches.value = [{ staticData: { breadcrumb: { labelKey: 'nav.page.logs', to: routePaths.logs } } }]
    const view = renderHook(() => useRouteBreadcrumbs())

    const first = view.result.current
    view.rerender()

    expect(view.result.current).toBe(first)
  })

  it('翻译跟着语言走：中文取中文目录里的词', () => {
    matches.value = [{ staticData: { breadcrumb: { labelKey: 'nav.page.settings', to: routePaths.runtimeSettings } } }]
    const { result } = renderHook(() => useRouteBreadcrumbs())

    expect(result.current[0]?.label).toBe('设置')
  })
})
