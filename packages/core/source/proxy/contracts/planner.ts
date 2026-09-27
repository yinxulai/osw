import type { Protocol } from '@common/schemas'
import type { UpstreamTarget } from './transport'

/** 候选耗尽的原因。执行器用它决定拒绝码，不再自己判断空数组的含义。 */
export type PlanExhaustedReason = 'model-not-configured' | 'manual-model-unavailable' | 'no-available-provider' | 'none'

export interface PlannerInput {
  readonly logicalModelId: string
  /** 客户端说的协议。规划器只认它，不去猜上游该是什么协议——那是端点配置的事。 */
  readonly clientProtocol: Protocol
  /** 管理端手工锁定的模型。非空时规划器只返回它，并忽略健康状态与启用开关。 */
  readonly manualModelId: string | null
}

export interface PlanResult {
  readonly targets: readonly UpstreamTarget[]
  /** `targets` 非空时为 `'none'`。 */
  readonly reason: PlanExhaustedReason
  /**
   * 候选为空时的用户可见说明（入口用它拼错误信息与日志）。
   *
   * 规划器最清楚「为什么一个候选都没有」（缺协议、被手动锁定、没有启用的供应商……），
   * 让入口去猜只会让原因在两个地方各写一遍、并很快不同步。
   */
  readonly detail?: string
}

/**
 * 尝试规划器：唯一知道「这次请求该发往哪些上游、按什么顺序发」的地方。
 *
 * 执行器不再做路由决策：它只拿规划器给出的有序目标列表依次尝试。换一种策略
 * （成本最低、延迟最低、工作流编排）就是换一个规划器实现。
 */
export interface AttemptPlanner {
  readonly id: string
  plan(input: PlannerInput): PlanResult | Promise<PlanResult>
  /**
   * 批量规划可选口。
   *
   * 路由图可能给出多个有序落点，落点规划器必须一次回答完它们的候选，才能避免
   * 「每个落点重新查一遍模型、供应商、健康状态」的 N+1。实现必须在输入顺序上返回结果；
   * 不实现时调用方会逐条回退到 `plan()`。
   */
  planMany?(inputs: readonly PlannerInput[]): Promise<readonly PlanResult[]>
}
