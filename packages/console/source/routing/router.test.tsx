// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { router } from '@/routing/router'
import { appNavigationItems } from '@/routing/navigation'
import { routeBreadcrumbMetadata } from '@/routing/route-breadcrumbs'
import { routePaths } from '@/routing/routes'
import { isThemeParam, parseOverrides } from '@/routing/url-overrides'

// 这些用例只钉住「路径契约」，不渲染任何页面：
// 路径字符串集中在 `./routes.ts`，这里负责证明它们真的能在路由表里解析出来，
// 避免出现「改了 `./routes.ts` 却忘了改 `./router.tsx`」这类静默失效。
/** 这里只关心三件事：命中的路由 id、路径参数、以及解析后的 search。 */
interface LeafMatch {
  routeId: string
  params: Partial<Record<string, string>>
  search: Record<string, unknown>
}

const leafMatch = (path: string, search: Record<string, unknown> = {}): LeafMatch => {
  const matches = router.matchRoutes(path, search)
  return matches[matches.length - 1] as unknown as LeafMatch
}

const breadcrumbMatches = (path: string) => router.matchRoutes(path).flatMap(match => {
  const metadata = routeBreadcrumbMetadata(match.staticData)
  return metadata ? [metadata] : []
})

describe('路由路径契约', () => {
  it('每个声明过的路径都解析到自己', () => {
    const cases: Array<[string, string]> = [
      [routePaths.onboarding, routePaths.onboarding],
      [routePaths.router, routePaths.router],
      [routePaths.logicalModels, routePaths.logicalModels],
      [routePaths.modelManagement, routePaths.modelManagement],
      [routePaths.requestRewriteRules, routePaths.requestRewriteRules],
      [routePaths.requestLogs, routePaths.requestLogs],
      [routePaths.runtimeSettings, routePaths.runtimeSettings],
      [routePaths.logs, routePaths.logs],
      // 父路由没有自己的页面，落到索引子路由上。
      [routePaths.overview, `${routePaths.overview}/`],
      ['/overview/demo', `${routePaths.overview}/$providerId`],
      [routePaths.clientConfig, `${routePaths.clientConfig}/`],
      ['/client-config/claude-code', `${routePaths.clientConfig}/$clientKey`],
    ]
    for (const [requested, expectedId] of cases) {
      expect(leafMatch(requested)?.routeId, requested).toBe(expectedId)
    }
  })

  it('路径里不含语言段：语言是查询参数，不参与匹配', () => {
    // 这是把语言从路径段挪进查询串的核心收益：路径表只回答「哪个页面」，
    // 于是同一个页面永远只有一个地址形态，不需要「同一棵树吃下两种路径」的额外设计。
    for (const path of [routePaths.router, routePaths.runtimeSettings, routePaths.clientConfig]) {
      expect(leafMatch(path)?.params).toEqual({})
    }
  })

  it('语言与主题都不影响命中的页面', () => {
    for (const path of [routePaths.router, routePaths.logs, routePaths.overview]) {
      expect(leafMatch(path, { lang: 'zh-CN', theme: 'dark' })?.routeId, path).toBe(leafMatch(path)?.routeId)
    }
  })

  it('统计分析的时间范围会被校验并兜底到 7d', () => {
    expect(leafMatch(routePaths.overview, { range: 'today' })?.search).toEqual({ range: 'today', lang: undefined, theme: undefined })
    expect(leafMatch(routePaths.overview, { range: 'nope' })?.search).toEqual({ range: '7d', lang: undefined, theme: undefined })
    expect(leafMatch('/overview/demo', { range: '30d' })?.search.range).toBe('30d')
  })

  it('运行日志的关键词会被裁剪，空值直接丢弃', () => {
    expect(leafMatch(routePaths.logs, { q: '  abc  ' })?.search.q).toBe('abc')
    expect(leafMatch(routePaths.logs, { q: '   ' })?.search.q).toBeUndefined()
  })

  it('认不出的语言会被丢掉而不是拦住地址，写错的主题同样被丢掉', () => {
    // 查询参数里的语言写错，后果只是「这一项没值」→ 界面退回偏好语言；
    // 换成路径段时代价是整段路径 404，这正是这次收敛要消掉的分叉。
    const matched = leafMatch(routePaths.router, { lang: 'fr', theme: 'blue' })
    expect(matched?.routeId).toBe(routePaths.router)
    expect(matched?.search).toEqual({ lang: undefined, theme: undefined })
  })

  it('中文变体会被归一成 zh-CN', () => {
    expect(leafMatch(routePaths.router, { lang: 'zh-TW' })?.search.lang).toBe('zh-CN')
  })

  it('供应商下钻的链接会同时带上路径参数与时间范围', () => {
    const href = router.buildLocation({
      to: routePaths.overviewProvider,
      params: { providerId: 'abc' },
      search: { range: 'today' },
    }).href
    expect(href).toBe('/overview/abc?range=today')
  })

  it('客户端详情的链接会把客户端 key 写进路径', () => {
    const href = router.buildLocation({
      to: routePaths.clientConfigDetail,
      params: { clientKey: 'claude-code' },
    }).href
    expect(href).toBe('/client-config/claude-code')
  })

  it('语言与主题会作为查询参数写进链接', () => {
    const href = router.buildLocation({
      to: routePaths.logs,
      search: { lang: 'zh-CN', theme: 'dark' },
    }).href
    expect(href).toBe('/logs?lang=zh-CN&theme=dark')
  })

  it('侧栏页面通过自己的路由自动注册面包屑', () => {
    for (const item of appNavigationItems) {
      expect(breadcrumbMatches(item.to), item.to).toEqual([{ labelKey: item.labelKey, to: item.to }])
    }
  })

  it('详情页只注册父级，动态叶子由页面补充', () => {
    expect(breadcrumbMatches('/overview/demo')).toEqual([
      { labelKey: 'nav.page.overview', to: routePaths.overview },
    ])
    expect(breadcrumbMatches('/client-config/claude-code')).toEqual([
      { labelKey: 'nav.page.clientConfig', to: routePaths.clientConfig },
    ])
  })
})

/**
 * 下面这些用例必须真的走一次导航（而不是只解析路径），因为要验证的东西挂在
 * `validateSearch` 与中间件上 —— 光看 `matchRoutes` 的结果看不到跨页保留。
 */
describe('地址栏浏览行为', () => {
  /**
   * 模拟「在地址栏里敲一条地址」：直接写 history 再让路由重新解析。
   *
   * 不能用 `navigate({ to })` 代替 —— `to` 是**路径**，整条 `?a=b` 会被当成路径的一部分
   * 转义进 URL，落成的地址是 `/router?x=%3F...`。手改地址栏走的是 history，
   * 这里也只有走 history 才是在测真实入口。
   */
  const go = async (href: string) => {
    router.history.replace(href)
    await router.load()
    return router.state.location.href
  }

  it('语言与主题在跨页跳转之间被保留', async () => {
    await go('/router?lang=zh-CN&theme=dark')
    await router.navigate({ to: routePaths.logs, replace: true })
    expect(router.state.location.href).toBe('/logs?lang=zh-CN&theme=dark')
  })

  it('跳转时不显式带上主题，同页的其它搜索参数也不会被误伤', async () => {
    await go('/overview?range=today&lang=en&theme=light')
    await router.navigate({ to: '.', search: { range: '30d' }, replace: true })
    const search = new URLSearchParams(router.state.location.search)
    expect(search.get('range')).toBe('30d')
    expect(search.get('lang')).toBe('en')
    expect(search.get('theme')).toBe('light')
  })

  it('手改地址栏可以指定语言与主题', async () => {
    const href = await go('/router?lang=zh-CN&theme=light')
    expect(href).toBe('/router?lang=zh-CN&theme=light')
    expect(parseOverrides(href)).toEqual({ lang: 'zh-CN', theme: 'light' })
  })
})

describe('地址栏覆盖值解析', () => {
  it('从 href 里读出语言与主题', () => {
    expect(parseOverrides('#/router?lang=zh-CN&theme=dark')).toEqual({ lang: 'zh-CN', theme: 'dark' })
  })

  it('没有覆盖时两项都是 null', () => {
    expect(parseOverrides('#/router')).toEqual({ lang: null, theme: null })
  })

  it('不受支持的语言与非法主题都算作没有覆盖', () => {
    expect(parseOverrides('#/router?lang=fr&theme=blue')).toEqual({ lang: null, theme: null })
  })

  it('语言在查询串里，路径参数不会被误认成语言', () => {
    expect(parseOverrides('#/overview/zh-CN')).toEqual({ lang: null, theme: null })
  })

  it('中文变体会被归一到 zh-CN', () => {
    expect(parseOverrides('#/zh/router?lang=zh').lang).toBe('zh-CN')
  })

  it('「跟随系统」是合法的主题值，不是「没有值」', () => {
    expect(parseOverrides('#/router?theme=system').theme).toBe('system')
    expect(isThemeParam('system')).toBe(true)
    expect(isThemeParam('blue')).toBe(false)
  })
})
