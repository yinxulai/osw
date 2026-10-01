import type { RouteRuleSetVersionSummary } from '@common/router/route-rules'
import type { RouterGraphVersionSummary } from '@common/router/types'

/**
 * 历史版本的展示模型：两种路由模式共用。
 *
 * 每一版在服务端都是一条**独立记录**（路由图在 `workflows` 表，规则表在 `route_rule_sets` 表），
 * 记录 id 才是它的身份；`version` 只是给人看的排序号，删掉一版再存一版，版本号照旧往上走。
 * 界面只把它翻成列表要显示的样子：保存时间统一成 ISO 字符串，恢复时传记录 id。
 *
 * 这里**没有任何本地存储**：定义存在哪、由谁读，都收敛到服务端一处。
 */
export interface RouteVersion {
  /** 服务端的记录 id：恢复这一版时要传的也是它。 */
  id: string
  /** 给人看的版本号（v1、v2 …）；只用于显示与「下一个版本号」的推算。 */
  sequence: number
  /** 用户给这一版起的名字；没起名时为空串（列表就只显示版本号）。 */
  name: string
  /** 用户给这一版写的说明；没写时为空串。 */
  description: string
  /** 保存时间（ISO 8601） */
  savedAt: string
  /** 摘要里那件「有几样东西」的数字：图的节点数 / 规则表的规则条数，列表用来说明这一版的规模 */
  itemCount: number
}

function toRouteVersion(id: string, version: number, name: string, description: string, savedAt: number, itemCount: number): RouteVersion {
  return {
    id,
    sequence: version,
    name,
    description,
    savedAt: new Date(savedAt).toISOString(),
    itemCount,
  }
}

/** 路由图的服务端摘要 → 列表模型。 */
export function toRouterGraphVersion(summary: RouterGraphVersionSummary): RouteVersion {
  return toRouteVersion(summary.id, summary.version, summary.name, summary.description, summary.savedAt, summary.nodeCount)
}

/** 路由图的服务端摘要列表 → 列表模型；顺序沿用服务端给的（新的在前）。 */
export function toRouterGraphVersions(summaries: RouterGraphVersionSummary[]): RouteVersion[] {
  return summaries.map(toRouterGraphVersion)
}

/** 规则表的服务端摘要 → 列表模型。 */
export function toRouteRuleSetVersion(summary: RouteRuleSetVersionSummary): RouteVersion {
  return toRouteVersion(summary.id, summary.version, summary.name, summary.description, summary.savedAt, summary.ruleCount)
}

/** 规则表的服务端摘要列表 → 列表模型；顺序沿用服务端给的（新的在前）。 */
export function toRouteRuleSetVersions(summaries: RouteRuleSetVersionSummary[]): RouteVersion[] {
  return summaries.map(toRouteRuleSetVersion)
}

/**
 * 服务端是否已经保存过至少一版定义。
 *
 * 一版都没保存过时，读当前生效的定义拿到的是**内建默认**那一份，版本号为 0
 * （`UNSAVED_ROUTER_GRAPH_VERSION` 与 `UNSAVED_ROUTE_RULE_VERSION` 都是 0，真实版本号从 1 开始）：
 * 它确实是代理此刻在执行的定义，但不是「用户存下来的」，所以界面要把它当成「内容尚未保存」——
 * 否则保存按钮一打开就是灰的，用户没办法把这份默认内容存成 v1。
 */
export function hasSavedVersion(version: number): boolean {
  return version > 0
}

/** `2026-09-11 22:41`，列表里按保存时间倒序展示。 */
export function formatVersionTime(savedAt: string): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return savedAt
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
