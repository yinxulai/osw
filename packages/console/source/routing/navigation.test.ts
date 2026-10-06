import { describe, expect, it } from 'vitest'
import { appNavigationItems, findCurrentNavigationItem } from './navigation'
import { routePaths } from './routes'
import { getTranslator } from '@/i18n/active'

/*
 * 侧边栏导航清单 + 「当前在哪一项」的判定。
 *
 * 判定用的是**前缀**匹配（`/model-management/xxx` 属于「模型管理」），所以边界要守：
 * `/model-managementx` 不是 `/model-management` 的子页面，不该被判进去。
 * 这类错误在界面上表现成「点了很久看不出哪里高亮错了」，很难靠肉眼发现。
 */

describe('findCurrentNavigationItem', () => {
  it('matches top-level pages and their detail routes', () => {
    expect(findCurrentNavigationItem('/overview')?.to).toBe('/overview')
    expect(findCurrentNavigationItem('/overview/provider-1')?.to).toBe('/overview')
    expect(findCurrentNavigationItem('/client-config/openai')?.to).toBe('/client-config')
  })

  it('does not treat a same-prefix sibling as a child route', () => {
    expect(findCurrentNavigationItem('/request-logs-extra')).toBeUndefined()
  })

  it('路径完全一致时命中', () => {
    expect(findCurrentNavigationItem(routePaths.modelManagement)?.to).toBe(routePaths.modelManagement)
  })

  it('前缀相似但并非子页面时不算命中（`/model-managementx` 不是子路径）', () => {
    expect(findCurrentNavigationItem(`${routePaths.modelManagement}x`)).toBeUndefined()
  })

  it('认证页（不在导航清单里）没有对应项', () => {
    expect(findCurrentNavigationItem(routePaths.onboarding)).toBeUndefined()
  })

  it('站外式路径与根路径都没有对应项（根路由会重定向到首项）', () => {
    expect(findCurrentNavigationItem('/definitely-not-a-page')).toBeUndefined()
    expect(findCurrentNavigationItem('/')).toBeUndefined()
  })
})

describe('导航清单', () => {
  it('每一项的路径都是路由表里的一级路径（不含带参数的详情页与引导页）', () => {
    const firstLevel = [
      routePaths.router,
      routePaths.logicalModels,
      routePaths.modelManagement,
      routePaths.overview,
      routePaths.requestLogs,
      routePaths.requestRewriteRules,
      routePaths.clientConfig,
      routePaths.logs,
      routePaths.runtimeSettings,
    ]

    expect(appNavigationItems.map(item => item.to).sort()).toEqual([...firstLevel].sort())
  })

  it('顺序就是侧边栏的阅读顺序：路由 → 逻辑模型 → 供应商 → 数据 → 进阶 → 系统', () => {
    expect(appNavigationItems.map(item => item.labelKey)).toEqual([
      'nav.page.router',
      'nav.page.logicalModels',
      'nav.page.providers',
      'nav.page.overview',
      'nav.page.requests',
      'nav.page.rules',
      'nav.page.clientConfig',
      'nav.page.logs',
      'nav.page.settings',
    ])
  })

  it('每一项都有图标与分组（分组决定侧边栏的分节标题）', () => {
    for (const item of appNavigationItems) {
      expect(item.icon).toBeTruthy()
      expect(item.sectionKey.startsWith('nav.section.')).toBe(true)
    }
  })

  it('标签互不重复，且每一段的分组名都能取到词', () => {
    const t = getTranslator('zh-CN')

    const labels = appNavigationItems.map(item => t(item.labelKey))
    expect(new Set(labels).size).toBe(labels.length)

    const sections = [...new Set(appNavigationItems.map(item => item.sectionKey))]
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) {
      const text = t(section)
      expect(text).toBeTruthy()
      expect(text).not.toBe(section)
    }
  })

  it('路径不重复（同一路径两项会让「当前项」判定只能选中第一个）', () => {
    const paths = appNavigationItems.map(item => item.to)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('路径不带查询串、不带尾斜杠（前缀匹配靠它）', () => {
    for (const item of appNavigationItems) {
      expect(item.to.startsWith('/')).toBe(true)
      expect(item.to).not.toContain('?')
      expect(item.to).not.toContain('#')
      expect(item.to.endsWith('/')).toBe(false)
    }
  })

  it('每一项都能被自己的路径判成「当前项」（清单与判定用的是同一份路径）', () => {
    for (const item of appNavigationItems) {
      expect(findCurrentNavigationItem(item.to)?.to).toBe(item.to)
    }
  })
})
