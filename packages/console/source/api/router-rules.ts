import type { RouteRuleSet, RouteRuleSetSaveResult, RouteRuleSetVersionSummary, RouteRuleSnapshot } from '@common/router/route-rules'
import type { RouteRuleRunResult } from '@common/router/route-rule-engine'
import { request } from './client'

/**
 * 路由规则表的读写接口。
 *
 * 与路由图**完全独立**：读写的是另一份定义（服务端 `workflows` 表里 `type = 'route-rules'`），
 * 图的版本列表与它无关。两边**形状一致**：读当前生效的、列版本、读指定版本、保存为新版本。
 * 界面不缓存它，读到的就是当前生效的那一份。
 * 试跑同样交给服务端：条件里的头名匹配、可变落点的取值语义都由引擎一处实现，
 * 界面拿到的判定过程与代理真实执行的完全一致。
 */
export const routerRulesApi = {
  run: (ruleSet: RouteRuleSet, inputPayload: unknown, signal?: AbortSignal) =>
    request<RouteRuleRunResult>('/router/rules/run', { ruleSet, inputPayload }, { signal }),
  /** 当前生效的规则表；一版都没保存过时是内建默认表（版本号为 `UNSAVED_ROUTE_RULE_VERSION`）。 */
  getRules: () => request<RouteRuleSnapshot>('/router/rules'),
  /** 版本摘要列表（新的在前）。 */
  getRuleVersions: () => request<RouteRuleSetVersionSummary[]>('/router/rules/versions'),
  /** 按版本号读规则表；版本不存在时返回 `null`。 */
  getRuleVersion: (id: string) => request<RouteRuleSnapshot | null>('/router/rules/version', { id }),
  /** 保存为新版本，它立即对代理生效；内容与最新版一致时不新建版本。 */
  saveRules: (ruleSet: RouteRuleSet, name: string, description: string) =>
    request<RouteRuleSetSaveResult>('/router/rules/save', { ruleSet, name, description }),
}
