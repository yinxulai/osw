// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { router } from '@/routing/router'
import { routePaths } from '@/routing/routes'

// 这些用例只钉住「路径契约」，不渲染任何页面：
// 路径字符串集中在 `./routes.ts`，这里负责证明它们真的能在路由表里解析出来，
// 避免出现「改了 `./routes.ts` 却忘了改 `./router.tsx`」这类静默失效。
const leafMatch = (path: string, search: Record<string, unknown> = {}) => {
  const matches = router.matchRoutes(path, search)
  return matches[matches.length - 1]
}

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
      ['/overview/demo', '/overview/$providerId'],
      [routePaths.clientConfig, `${routePaths.clientConfig}/`],
      ['/client-config/claude-code', '/client-config/$clientKey'],
    ]
    for (const [requested, expectedId] of cases) {
      expect(leafMatch(requested)?.routeId, requested).toBe(expectedId)
    }
  })

  it('已废弃的路径不再匹配任何页面', () => {
    for (const legacy of ['/providers', '/access', '/access-config', '/rules', '/requests', '/settings']) {
      expect(leafMatch(legacy)?.routeId, legacy).toBe('__root__')
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
      params: { clientKey: 'gemini-cli' },
    }).href
    expect(href).toBe('/client-config/gemini-cli')
  })
})
