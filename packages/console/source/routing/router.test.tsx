// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { router } from '@/routing/router'
import { routePaths, SHELL_PREFIX } from '@/routing/routes'
import { langParams, parseOverrides } from '@/routing/url-overrides'

// 这些用例只钉住「路径契约」，不渲染任何页面：
// 路径字符串集中在 `./routes.ts`，这里负责证明它们真的能在路由表里解析出来，
// 避免出现「改了 `./routes.ts` 却忘了改 `./router.tsx`」这类静默失效。
//
// 期望值里出现 `{-$lang}` 是刻意的：这是路由表里的**模板形态**，`routeId` 本来就长这样。
// 用户看到的地址（`/router`、`/zh-CN/router`）不在这里断言，而在下面的「带语言与不带语言」用例里。
/** 这里只关心三件事：命中的路由 id、路径参数、以及解析后的 search。 */
interface LeafMatch {
  routeId: string
  params: Partial<Record<string, string>>
  search: Record<string, unknown>
}

const leafMatch = (path: string, search: Record<string, unknown> = {}): LeafMatch => {
  const matches = router.matchRoutes(path, search)
  return matches[matches.length - 1] as LeafMatch
}

const withLang = (lang: string, path: string) => `${SHELL_PREFIX.replace('{-$lang}', lang)}${path.slice(SHELL_PREFIX.length)}`

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
      ['/overview/demo', `${SHELL_PREFIX}/overview/$providerId`],
      [routePaths.clientConfig, `${routePaths.clientConfig}/`],
      ['/client-config/claude-code', `${SHELL_PREFIX}/client-config/$clientKey`],
    ]
    for (const [requested, expectedId] of cases) {
      expect(leafMatch(requested)?.routeId, requested).toBe(expectedId)
    }
  })

  it('带语言段与不带语言段落到同一条路由', () => {
    for (const path of [routePaths.router, routePaths.runtimeSettings, routePaths.clientConfig]) {
      // 两种地址是**同一条**叶子路由：语言段只体现在 `params.lang` 上，路由表里没有第二套。
      const bare = leafMatch(path)
      const prefixed = leafMatch(withLang('zh-CN', path))
      expect(prefixed?.routeId, path).toBe(bare?.routeId)
      expect(prefixed?.params.lang, path).toBe('zh-CN')
    }
  })

  it('已废弃的路径只会落到外壳索引，不再匹配任何页面', () => {
    for (const legacy of ['/providers', '/access', '/access-config', '/rules', '/requests', '/settings']) {
      // `/providers` 里的 `providers` 会被这一步当成语言段吃进 `params.lang`，
      // 但外壳的 `beforeLoad` 随后会把它判为非法语言并抛 `notFound`（见下一条用例），
      // 因此这些旧地址既不会渲染出页面，也不会把不认识的语言留在地址栏里。
      expect(leafMatch(legacy)?.routeId, legacy).toBe(`${SHELL_PREFIX}/`)
    }
  })

  it('统计分析的时间范围会被校验并兜底到 7d', () => {
    expect(leafMatch(routePaths.overview, { range: 'today' })?.search).toEqual({ range: 'today' })
    expect(leafMatch(routePaths.overview, { range: 'nope' })?.search).toEqual({ range: '7d' })
    expect(leafMatch('/overview/demo', { range: '30d' })?.search).toEqual({ range: '30d' })
  })

  it('运行日志的关键词会被裁剪，空值直接丢弃', () => {
    expect(leafMatch(routePaths.logs, { q: '  abc  ' })?.search).toEqual({ q: 'abc' })
    expect(leafMatch(routePaths.logs, { q: '   ' })?.search).toEqual({ q: undefined })
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

  it('带上语言参数后，构建出的链接会把语言段写进路径', () => {
    const href = router.buildLocation({
      to: routePaths.logs,
      params: langParams('zh-CN'),
    }).href
    expect(href).toBe('/zh-CN/logs')
  })
})

/**
 * 下面这些用例必须真的走一次导航（而不是只解析路径），因为要验证的东西全都发生在
 * `beforeLoad` 与中间件里 —— 光看 `matchRoutes` 的结果看不到语言继承和 theme 保留。
 */
describe('地址栏浏览行为', () => {
  /** 导航到某个绝对地址，返回落地后的地址与各层匹配的状态。 */
  const go = async (href: string) => {
    await router.navigate({ to: href as never, replace: true }).catch(() => undefined)
    return {
      href: router.state.location.href,
      statuses: router.state.matches.map(match => `${match.routeId}:${match.status}`),
    }
  }

  /** 外壳那一层的匹配状态：`notFound` 就是闸门拦下了这个地址。 */
  const shellStatus = () => router.state.matches.find(match => match.routeId === SHELL_PREFIX)?.status

  it('外壳有语言段且语言合法时，页面正常渲染', async () => {
    const landed = await go('/zh-CN/router')
    expect(landed.href).toBe('/zh-CN/router')
    expect(landed.statuses).toContain(`${routePaths.router}:success`)
  })

  it('语言段认不出时外壳判定为找不到，合法语言段才通过', async () => {
    // 外壳那一层进 `notFound`，渲染时由外层的 notFound 边界接管（`defaultNotFoundComponent` 拉回首页），
    // 于是「语言不认识但页面照开」这个状态不会出现。合法语言段则一路 success。
    await go('/fr/router')
    expect(shellStatus()).toBe('notFound')

    await go('/zh-CN/router')
    expect(shellStatus()).toBe('success')
  })

  it('除掉语言段之外的旧地址也会被闸门拦下', async () => {
    await go('/providers')
    expect(shellStatus()).toBe('notFound')
  })

  it('从带语言段的地址跳到别的页面时会带上同一个语言段', async () => {
    await go('/zh-CN/router')
    await router.navigate({ to: routePaths.logs, replace: true })
    expect(router.state.location.href).toBe('/zh-CN/logs')
  })

  it('theme 在同级跳转之间被保留，语言段同时被带上', async () => {
    await go('/zh-CN/router?theme=dark')
    await router.navigate({ to: routePaths.logs, search: {}, replace: true })
    expect(router.state.location.href).toBe('/zh-CN/logs?theme=dark')
  })

  it('写进语言段与清掉语言段都能原地生效', async () => {
    await go('/router')
    await router.navigate({ to: routePaths.router, params: { lang: 'zh-CN' }, replace: true })
    expect(router.state.location.pathname).toBe('/zh-CN/router')
    await router.navigate({ to: '.', params: { lang: undefined }, replace: true })
    expect(router.state.location.pathname).toBe('/router')
  })
})

describe('地址栏覆盖值解析', () => {
  it('从 href 里读出语言段与主题', () => {
    expect(parseOverrides('#/zh-CN/router?theme=dark')).toEqual({ lang: 'zh-CN', theme: 'dark' })
  })

  it('没有覆盖时两项都是 null', () => {
    expect(parseOverrides('#/router')).toEqual({ lang: null, theme: null })
  })

  it('不受支持的语言段与非法主题都算作没有覆盖', () => {
    expect(parseOverrides('#/fr/router?theme=blue')).toEqual({ lang: null, theme: null })
  })

  it('只看第一个路径段，普通参数里的语言名不算覆盖', () => {
    expect(parseOverrides('#/overview/zh-CN')).toEqual({ lang: null, theme: null })
  })

  it('中文变体会被归一到 zh-CN', () => {
    expect(parseOverrides('#/zh/router').lang).toBe('zh-CN')
  })

  it('langParams(null) 表示去掉语言段', () => {
    expect(langParams(null)).toEqual({ lang: undefined })
    expect(langParams('en')).toEqual({ lang: 'en' })
  })
})
