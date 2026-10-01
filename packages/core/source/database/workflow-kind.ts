/**
 * `workflows.type` 目前只有一个取值：路由图。
 *
 * 路由规则表过去也住在这张表里（`type = 'route-rules'`），现在已经搬到自己的
 * `route_rule_sets` 表（见 `config-schema.ts` 与 `route-rule-store.ts`）。
 * 常量留在这里而不是 store 里，是因为 `logical-model-store` 与 `router-graph-store`
 * 都要 import 它：类型判别值属于表，不属于某一个 store。
 */

/** 路由图：`workflows` 里 `type = 'router'` 的行，一行一版。 */
export const ROUTER_GRAPH_TYPE = 'router'
