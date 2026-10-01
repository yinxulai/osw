/**
 * 功能闸门：把**已经实现、但暂不开放**的能力整段关掉，而不删除它的类型与实现。
 *
 * 之所以要有这个文件，而不是直接把代码删掉，是因为「关闭」与「删除」是两件事：
 * 删掉之后重新开放要从历史里捞代码、要重跑一遍评审；关掉之后重新开放只是把下面的常量
 * 翻回 `true`。类型、Schema、引擎、修改器、示例、测试全部原样留在系统里——**关的是入口，
 * 不是能力本身**。
 *
 * 与 `delivery-shape.ts` 里那根轴的关系：那根轴回答「这份正文在这种形态下能不能按路径改」，
 * 是**能力**层面的判定；这里的闸门回答「这个入口今天开不开放」，是**产品**层面的判定。
 * 两者正交：闸门关着时，能力判定压根不会被问到（响应改写修改器根本不注册）。
 */

import type { RuleStage } from './schemas'

/**
 * 响应阶段改写（response-stage rewrite）开关。
 *
 * **为什么关闭**：非流式（整包）响应能按路径改写，但占绝大多数的 SSE 流式响应改不了
 * （见 `docs/product/request-rewrite-rules.md` §6.1 与 §12 的 C 行）。让用户在「响应」阶段
 * 配好一串动作、到真实请求才发现流式下**什么都不发生**，比根本不提供这个阶段更糟：
 * 前者是静默的谎言，后者只是缺一个功能。在事件级改写评审通过并落地之前，把整个响应
 * 阶段从产品里关掉。
 *
 * **关闭的是哪些入口**（类型与实现全部保留）：
 * - 渲染层：动作编辑器与试跑用例的阶段下拉不再列出 `response`；
 * - 内核：`response-rewrite` 修改器**不注册**，响应规则一次都不会执行；
 * - 管理 API：写入与试跑入口拒绝带响应阶段动作 / 用例的请求，拒绝带具名错误码。
 *
 * **没有关闭的**：
 * - `RuleStage` 类型、`RequestRewriteRuleActionSchema.stage`、`delivery-shape.ts` 的
 *   `stageShapeSupport` / `isStageRunnable` 以及它们的单测——它们是「能力」的表述，原样保留；
 * - 库里既有的响应阶段数据（如果存在）仍能读出，翻回 `true` 后即刻恢复可用。
 *
 * 类型标注成 `boolean`（而不是让 TS 推成字面量 `false`）是刻意的：字面量类型会把所有
 * `if (RESPONSE_REWRITE_ENABLED)` 的「开」分支判成死代码，打包时可能顺手把它裁掉——
 * 那我们就又回到了「删掉」而不是「关闭」。标注成 `boolean`，两条分支都留在产物里，
 * 差别只在运行时取哪条。
 */
export const RESPONSE_REWRITE_ENABLED: boolean = false

/**
 * 界面里**可选**的规则阶段。它是 {@link RESPONSE_REWRITE_ENABLED} 的派生视图，是渲染层
 * 唯一该读的阶段清单——每个下拉都自己写一遍 `['request', 'response']`，关闭时就会漏掉某一处，
 * 于是「响应」从一个下拉里消失、却从另一个下拉里继续可选。
 *
 * 注意它只约束**可选集合**，不约束类型：`RuleStage` 仍是 `'request' | 'response'`，
 * 既有数据与既有类型的语义都不变。
 */
export const ENABLED_RULE_STAGES: readonly RuleStage[] = RESPONSE_REWRITE_ENABLED
  ? ['request', 'response']
  : ['request']
