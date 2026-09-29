import type { UiCatalogKey } from './i18n/catalogs'
import type { LiveRequest, LiveRequestAttemptState, ProviderHealth, ProviderModelHealth } from './schemas'

/**
 * 供应商模型「此刻是什么状态」的纯推导。
 *
 * 这里是**唯一**一份：主控制台的模型行、托盘面板的模型行都从这里取结论，谁都不再
 * 自己写一遍优先级。两份实现只要有一处顺序不同，同一个模型就会在托盘上写着「待命」、
 * 在主界面上写着「处理中」——用户在托盘上最想看到的恰恰就是「它现在在不在干活」。
 *
 * 只放「输入数据 → 结论」这一步：没有 React、没有 i18n 实例、没有 DOM。文案由调用方
 * 按返回的 key 取（key 是界面目录里的键，编译期可校验）。
 */

/**
 * 尝试仍在推进的状态；落到其他状态后，请求不再算作「该模型正在处理」。
 */
const ACTIVE_ATTEMPT_STATES: ReadonlySet<LiveRequestAttemptState> = new Set([
  'connecting',
  'awaiting-upstream',
  'streaming',
])

/**
 * 每个正在处理请求的供应商模型此刻的在途请求数；键是供应商模型 id（`providerModelId`）。
 *
 * 一次请求只算在**最近一次尝试**落到的模型头上：故障转移之后旧模型立刻出局，
 * 「谁在干活」始终是列表里那一行，而不是整条候选链。请求还没开始尝试（仍在路由）、
 * 或这次尝试已经收尾时，谁都不算。
 */
export function providerModelProcessingCounts(requests: LiveRequest[] | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const request of requests ?? []) {
    if (request.status !== 'pending') continue

    const attempt = request.attempts.at(-1)
    if (!attempt || !ACTIVE_ATTEMPT_STATES.has(attempt.state)) continue
    counts.set(attempt.providerModelId, (counts.get(attempt.providerModelId) ?? 0) + 1)
  }

  return counts
}

/**
 * 供应商（或它下面这个模型）是否还在冷却期。
 *
 * 冷却记在健康度里（`cooldownUntilTime`），两处都可能给出：供应商级的是「整个供应商
 * 刚被打回」，模型级的是「这一个模型刚被打回」。任意一层没过期就算冷却——调度判定
 * 也是这么看的，界面不能比它更乐观。
 */
export function isProviderModelCooling(providerHealth: ProviderHealth | undefined, providerModelHealth: ProviderModelHealth | undefined, now: number = Date.now()): boolean {
  const providerCooldownUntil = providerHealth?.cooldownUntilTime
  const modelCooldownUntil = providerModelHealth?.cooldownUntilTime
  return Boolean(
    (providerCooldownUntil && providerCooldownUntil > now)
    || (modelCooldownUntil && modelCooldownUntil > now),
  )
}

/** 徽标语义。与主控制台 `Badge` 的 variant、托盘行的底色一一对应。 */
export type ProviderModelBadgeTone = 'info' | 'success' | 'destructive' | 'muted'

export interface ProviderModelBadge {
  tone: ProviderModelBadgeTone
  /** 文案键（界面目录）。`processing` 是唯一需要数量插值的那一个。 */
  key: UiCatalogKey
  /** 仅「处理中」有值：此刻在途的请求数。 */
  count?: number
}

export interface ProviderModelBadgeInput {
  /** 该模型此刻在途的请求数。 */
  processingCount: number
  /** 模型本体在模型管理里是否启用。停用时绑定开关也不该画成待命。 */
  modelEnabled: boolean
  /** 这条绑定是否启用。 */
  enabled: boolean
  /** 供应商或模型是否在冷却期（见 `isProviderModelCooling`）。 */
  cooling: boolean
  /** 手动调度下是否为当前选中的那一个。托盘不看调度模式，不传即视为未选中。 */
  selected?: boolean
}

/**
 * 一张徽标只回答一句话，优先级从「正在发生的事实」排到「配置状态」：
 *
 *   处理中（n） > 模型被停用 > 冷却 > 已选中 / 待命 > 绑定停用
 *
 * 「处理中」压过启用状态：此刻最要紧的是它正在干活。反过来不会冲突——停用的绑定与
 * 模型不会被调度，冷却中的模型也不会真的在处理请求。
 */
export function resolveProviderModelBadge(input: ProviderModelBadgeInput): ProviderModelBadge {
  if (input.processingCount > 0) {
    return { tone: 'info', key: 'logicalModels.row.processing', count: input.processingCount }
  }
  if (!input.modelEnabled) return { tone: 'muted', key: 'logicalModels.row.modelDisabled' }
  if (input.cooling) return { tone: 'destructive', key: 'logicalModels.row.cooling' }
  if (!input.enabled) return { tone: 'muted', key: 'common.state.disabled' }
  return {
    tone: 'success',
    key: input.selected ? 'logicalModels.row.selected' : 'logicalModels.row.standby',
  }
}
