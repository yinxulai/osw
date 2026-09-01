import type { Provider, ProviderModelRoute } from '@common/schemas'

/**
 * 队列中的一个渲染单元：要么是单个模型，要么是一个供应商分组（折叠/展开）。
 * 分组目前仅用于免费模型源托管的供应商（provider.queueGroupEnabled）。
 */
export type QueueUnit =
  | { kind: 'model'; id: string; model: ProviderModelRoute }
  | { kind: 'group'; id: string; providerId: string; providerName: string; models: ProviderModelRoute[] }

/** 单元在队列中的排序依据：组内最小 priority（即组内最靠前模型的位置） */
export function unitMinPriority(unit: QueueUnit): number {
  if (unit.kind === 'model') return unit.model.priority
  return unit.models.reduce((min, model) => Math.min(min, model.priority), Number.POSITIVE_INFINITY)
}

/**
 * 把扁平的模型列表按供应商聚合成队列单元：
 * - 开启了 queueGroupEnabled 的供应商，其模型聚合为一个 group 单元；
 * - 其余模型各自作为 model 单元。
 * 结果按单元内最小 priority 升序，保持队列顺序。
 */
export function buildQueueUnits(models: ProviderModelRoute[], providers: Record<string, Provider>): QueueUnit[] {
  const groupsByProvider = new Map<string, { provider: Provider; models: ProviderModelRoute[] }>()
  const standalone: ProviderModelRoute[] = []

  for (const model of models) {
    const provider = providers[model.providerId]
    if (provider?.queueGroupEnabled) {
      let entry = groupsByProvider.get(model.providerId)
      if (!entry) {
        entry = { provider, models: [] }
        groupsByProvider.set(model.providerId, entry)
      }
      entry.models.push(model)
    } else {
      standalone.push(model)
    }
  }

  const units: QueueUnit[] = [
    ...standalone.map<QueueUnit>(model => ({ kind: 'model', id: model.id, model })),
    ...[...groupsByProvider.values()].map<QueueUnit>(({ provider, models: groupModels }) => ({
      kind: 'group',
      id: `group:${provider.id}`,
      providerId: provider.id,
      providerName: provider.name,
      models: groupModels,
    })),
  ]

  return units.sort((a, b) => unitMinPriority(a) - unitMinPriority(b))
}

/**
 * 把（可能被整组移动过的）单元列表重新展开为扁平模型列表，
 * 组内模型保持原有相对顺序，组与单模型按单元顺序串联。
 */
export function flattenUnits(units: QueueUnit[]): ProviderModelRoute[] {
  const result: ProviderModelRoute[] = []
  for (const unit of units) {
    if (unit.kind === 'model') result.push(unit.model)
    else result.push(...unit.models)
  }
  return result
}

/** 判断某个 dnd-kit 条目 id 是否为分组头 */
export function isGroupUnitId(id: string): boolean {
  return id.startsWith('group:')
}
