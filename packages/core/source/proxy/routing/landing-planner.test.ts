import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanExhaustedReason, PlannerInput, PlanResult, UpstreamTarget } from '@server/proxy/contracts'
import { proxyTargetPlanner } from '@server/proxy/planners/target-planner'
import { NO_LANDING_DETAIL, planLandingTargets, type LandingPlan, type LandingPlanMiss } from '@server/proxy/routing/landing-planner'

const mocks = vi.hoisted(() => ({
  plans: new Map<string, PlanResult>(),
  manualModels: new Map<string, string>(),
  planned: [] as string[],
}))

vi.mock('@server/proxy/planners/target-planner', () => ({
  // 落点规划器与目标规划器共用同一句兜底说明（`landing-planner.ts` 的 `NO_PROVIDER_DETAIL`），
  // 这里必须一并交出来，否则被 mock 的模块给不出这个导出。
  NO_MODEL_DETAIL: 'This logical model has no enabled and healthy provider model',
  proxyTargetPlanner: {
    id: 'test-planner',
    plan: async (input: PlannerInput) => {
      mocks.planned.push(input.logicalModelId)
      return mocks.plans.get(input.logicalModelId) ?? { targets: [], reason: 'no-available-provider' as PlanExhaustedReason }
    },
  },
}))

vi.mock('@server/proxy/routing/manual-routing', () => ({
  getManualModel: (logicalModelId: string) => mocks.manualModels.get(logicalModelId) ?? null,
}))

afterEach(() => {
  mocks.plans.clear()
  mocks.manualModels.clear()
  mocks.planned = []
  proxyTargetPlanner.planMany = undefined
})

function target(providerModelId: string): UpstreamTarget {
  return {
    providerId: `prov_${providerModelId}`,
    providerName: 'Provider',
    providerModelId,
    providerModelName: providerModelId,
    apiKeyReference: 'key',
    customAuthHeader: null,
    endpointId: `endpoint_${providerModelId}`,
    protocol: 'openai-completions',
    url: `https://example.test/${providerModelId}`,
    timeoutMilliseconds: 30_000,
  }
}

/** 断言「一个落点都用不了」，把联合类型收窄到失败分支。 */
function expectMiss(plan: LandingPlan): LandingPlanMiss {
  if (plan.logicalModelId !== null) throw new Error(`预期落点全不可用，但拿到了可用落点 ${plan.logicalModelId}`)
  return plan
}

describe('planLandingTargets', () => {
  it('reports a missing landing when the graph returned no logical model', async () => {
    const plan = await planLandingTargets({ logicalModelIds: [], clientProtocol: 'openai-completions' })

    expect(plan).toEqual({ logicalModelId: null, targets: [], manualModelId: null, reason: 'model-not-configured', detail: NO_LANDING_DETAIL })
    expect(mocks.planned).toEqual([])
  })

  it('walks the landings in priority order and stops at the first one with candidates', async () => {
    mocks.plans.set('first', { targets: [], reason: 'no-available-provider', detail: 'The first landing has no available provider' })
    mocks.plans.set('second', { targets: [target('model_b')], reason: 'none' })

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second', 'third'], clientProtocol: 'openai-completions' })

    expect(plan.logicalModelId).toBe('second')
    expect(plan.targets).toHaveLength(1)
    expect(plan.manualModelId).toBeNull()
    // 胜出之后不再往下问：落点顺序是优先级，不是候选池。
    expect(mocks.planned).toEqual(['first', 'second'])
  })

  it('carries the manual model of the winning landing', async () => {
    mocks.manualModels.set('second', 'model_manual')
    mocks.plans.set('second', { targets: [target('model_manual')], reason: 'none' })

    const plan = await planLandingTargets({ logicalModelIds: ['second'], clientProtocol: 'openai-completions' })

    expect(plan).toMatchObject({ logicalModelId: 'second', manualModelId: 'model_manual' })
  })

  it('plans every landing in one batch when the planner supports it', async () => {
    const planMany = vi.fn(async (inputs: readonly PlannerInput[]) => inputs.map(input => (
      input.logicalModelId === 'second'
        ? { targets: [target('model_b')], reason: 'none' as const }
        : { targets: [], reason: 'no-available-provider' as const, detail: 'first is unavailable' }
    )))
    proxyTargetPlanner.planMany = planMany

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second', 'third'], clientProtocol: 'openai-completions' })

    expect(plan.logicalModelId).toBe('second')
    expect(planMany).toHaveBeenCalledOnce()
    expect(planMany).toHaveBeenCalledWith([
      { logicalModelId: 'first', clientProtocol: 'openai-completions', manualModelId: null },
      { logicalModelId: 'second', clientProtocol: 'openai-completions', manualModelId: null },
      { logicalModelId: 'third', clientProtocol: 'openai-completions', manualModelId: null },
    ])
    expect(mocks.planned).toEqual([])
  })

  it('lists every landing reason when none of them can be used', async () => {
    mocks.plans.set('first', { targets: [], reason: 'no-available-provider', detail: 'No enabled and healthy provider model' })
    mocks.plans.set('second', { targets: [], reason: 'no-available-provider' })

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second'], clientProtocol: 'openai-completions' })

    const miss = expectMiss(plan)
    expect(miss.reason).toBe('no-available-provider')
    // 规划器没给 detail 的落点要用兜底说明，错误信息里不能出现空白。
    expect(miss.detail).toBe('No landing logical model is usable (first: No enabled and healthy provider model; second: This logical model has no enabled and healthy provider model)')
    expect(mocks.planned).toEqual(['first', 'second'])
  })

  it('reports the manual locking as the reason when any landing failed because of it', async () => {
    mocks.manualModels.set('first', 'model_manual')
    mocks.plans.set('first', { targets: [], reason: 'manual-model-unavailable', detail: 'The manually selected ProviderModel is not available for this protocol' })
    mocks.plans.set('second', { targets: [], reason: 'no-available-provider' })

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second'], clientProtocol: 'openai-completions' })

    expect(expectMiss(plan).reason).toBe('manual-model-unavailable')
  })
})
