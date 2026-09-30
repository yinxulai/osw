/**
 * `workflows.type` 的两个取值：路由图与路由规则表。
 *
 * 放在这里而不是各自的 store 里，是因为两边都要 import 它们、而「逻辑模型改名/删除」
 * 又要同时改写这两类定义：常量留在 store 里就会让 `logical-model-store` 与
 * `router-graph-store` 互相引用。类型判别值属于表，不属于某一个 store，
 * 所以给它一个中立的家。
 */

/** 路由图：`workflows` 里 `type = 'router'` 的行，一行一版。 */
export const ROUTER_GRAPH_TYPE = 'router'

/** 路由规则表：`workflows` 里 `type = 'route-rules'` 的行，一行一版。 */
export const ROUTE_RULE_TYPE = 'route-rules'
