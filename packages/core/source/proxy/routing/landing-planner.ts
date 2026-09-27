import type { Protocol } from '@common/schemas'
import type { PlanExhaustedReason, PlannerInput, PlanResult, UpstreamTarget } from '../contracts'
import { proxyTargetPlanner } from '../planners/target-planner'
import { getManualModel } from './manual-routing'

/**
 * 落点规划：把路由图给出的**有序**落点逻辑模型列表铺成一份候选列表。
 *
 * 逻辑模型选择节点可以选多个模型（见 `docs/product/route-design.md`），因此「路由决策」与
 * 「可用候选」之间多了一层：图说先试 A 再试 B，而 A 可能一个可用供应商都没有。
 * 这一层就是那句话的执行者——按顺序问下去，第一个能用的落点胜出，
 * 全都不用时把每个落点各自的原因一起说清楚。
 *
 * 单个落点的候选仍由 `proxyTargetPlanner` 决定，这里不重复它的任何判断。
 */

/** 落点都不可用时的兜底说明：规划器没给 detail 时用它，避免错误信息出现空白。 */
const NO_PROVIDER_DETAIL = 'This logical model has no enabled and healthy provider model'

/** 图没有产出任何落点。 */
export const NO_LANDING_DETAIL = 'The routing graph selected no landing logical model'

export interface LandingPlanInput {
  /** 图算出的落点逻辑模型，按优先级排列 */
  readonly logicalModelIds: readonly string[]
  readonly clientProtocol: Protocol
}

/** 有落点可用：候选列表与它所属的逻辑模型一起给出，调用方不必再判断两者是否一致。 */
export interface LandingPlanHit {
  readonly logicalModelId: string
  readonly targets: readonly UpstreamTarget[]
  /** 该落点的手动锁定模型；供日志与诊断用 */
  readonly manualModelId: string | null
}

/** 一个落点都用不了：原因与说明一起交回，调用方按原因翻成拒绝码。 */
export interface LandingPlanMiss {
  readonly logicalModelId: null
  readonly targets: readonly []
  readonly manualModelId: string | null
  readonly reason: PlanExhaustedReason
  readonly detail: string
}

export type LandingPlan = LandingPlanHit | LandingPlanMiss

/** 某个落点不可用的原因，用于最后汇总成一句「都不可用」的说明。 */
interface UnavailableLanding {
  readonly logicalModelId: string
  readonly manualModelId: string | null
  readonly reason: PlanExhaustedReason
  readonly detail: string
}

export async function planLandingTargets(input: LandingPlanInput): Promise<LandingPlan> {
  if (input.logicalModelIds.length === 0) {
    return { logicalModelId: null, targets: [], manualModelId: null, reason: 'model-not-configured', detail: NO_LANDING_DETAIL }
  }

  const plannerInputs = input.logicalModelIds.map(logicalModelId => ({
    logicalModelId,
    clientProtocol: input.clientProtocol,
    manualModelId: getManualModel(logicalModelId),
  }))
  const plans = proxyTargetPlanner.planMany
    ? await proxyTargetPlanner.planMany(plannerInputs)
    : await planUntilFirstHit(plannerInputs)
  const unavailable: UnavailableLanding[] = []
  for (const [index, logicalModelId] of input.logicalModelIds.entries()) {
    const manualModelId = plannerInputs[index].manualModelId
    const plan = plans[index]
    if (plan.targets.length > 0) {
      return { logicalModelId, targets: plan.targets, manualModelId }
    }
    unavailable.push({ logicalModelId, manualModelId, reason: plan.reason, detail: plan.detail ?? NO_PROVIDER_DETAIL })
  }

  const last = unavailable[unavailable.length - 1]
  return {
    logicalModelId: null,
    targets: [],
    // 日志里记最后一个落点的手动锁定：它是用户最后能改的那个开关。
    manualModelId: last.manualModelId,
    // 手动锁定失败比「没有可用供应商」更具体：它指向用户的一次显式操作，
    // 因此只要有一个落点是因为它失败的，就按它报；否则沿用最后一个落点的原因。
    reason: unavailable.some(item => item.reason === 'manual-model-unavailable') ? 'manual-model-unavailable' : last.reason,
    detail: describeUnavailableLandings(unavailable),
  }
}

async function planUntilFirstHit(inputs: readonly PlannerInput[]): Promise<readonly PlanResult[]> {
  const plans: PlanResult[] = []
  for (const input of inputs) {
    const plan = await proxyTargetPlanner.plan(input)
    plans.push(plan)
    if (plan.targets.length > 0) break
  }
  return plans
}

/**
 * 逐条列出每个落点为什么用不了：落点顺序是用户排的，原因也得按同一个顺序交回给他。
 *
 * 只有一个落点时不做这层包装：「都不可用」在只有一个候选时是句废话，而它会把真正的原因
 * （例如「手动指定的模型当前不可用」）挤到括号里。错误信息应当正好说到出错的那件事。
 */
function describeUnavailableLandings(unavailable: readonly UnavailableLanding[]): string {
  if (unavailable.length === 1) return unavailable[0].detail
  const lines = unavailable.map(item => `${item.logicalModelId}: ${item.detail}`)
  return `No landing logical model is usable (${lines.join('; ')})`
}
