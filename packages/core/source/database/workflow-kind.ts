/**
 * `workflows.type` 目前只有一个取值：路由图。
 *
 * 路由规则表住在自己的 `route_rule_sets` 表里（见 `config-schema.ts` 与 `route-rule-store.ts`）。
 * 两种定义不共用一张表：共用一个行空间时 `id` 就没法自证是图还是表。
 * 常量留在这里而不是 store 里，是因为 `logical-model-store` 与 `router-graph-store`
 * 都要 import 它：类型判别值属于表，不属于某一个 store。
 */

/** 路由图：`workflows` 里 `type = 'router'` 的行，一行一版。 */
export const ROUTER_GRAPH_TYPE = 'router'
