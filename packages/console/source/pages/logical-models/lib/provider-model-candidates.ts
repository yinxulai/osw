import { providerApi } from '@/api/providers'
import { providerModelApi, schedulingPolicyApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'

/**
 * 「往逻辑模型里加供应商模型」这一次动作的全部领域逻辑。
 *
 * 这里没有 React：候选集怎么算、新绑定排在什么优先级、一次失败要不要回滚，都是**业务
 * 规则**，与弹窗长什么样无关。组件只负责把结果画出来。
 */

/** 候选列表里的一行：已经抹平了供应商名，只留选择与展示需要的字段。 */
export interface ProviderModelCandidate {
  id: string
  providerId: string
  providerName: string
  modelName: string
}

/** `buildProviderModelCandidates` 的入参：三份原始数据。 */
export interface BuildProviderModelCandidatesInput {
  providers: ReadonlyArray<{ id: string; name: string }>
  models: ReadonlyArray<{ id: string; providerId: string; modelName: string; enabled: boolean; deletedTime: number | null }>
  boundProviderModelIds: readonly string[]
}

/**
 * 计算可以加入某个逻辑模型的候选。
 *
 * 三条排除规则，各有理由：
 * - **软删除的不要**：它在列表里已经不存在了，加进来只会是一条指向空配置的绑定；
 * - **全局停用的不要**：加了也只能是一条关着的绑定，服务端也会拒绝为它打开绑定；
 * - **已经绑过的不要**：它不是候选，是现状，重复绑定只会在同一行上多一条策略。
 *
 * 供应商名按 `providerId` 查表补上；查不到时退回用 id 本身——比留空更容易让人看懂
 * 是哪一条数据出了问题。
 */
export function buildProviderModelCandidates(input: BuildProviderModelCandidatesInput): ProviderModelCandidate[] {
  const providerNameById = new Map(input.providers.map(provider => [provider.id, provider.name]))
  const bound = new Set(input.boundProviderModelIds)
  return input.models
    .filter(model => model.deletedTime === null && model.enabled && !bound.has(model.id))
    .map(model => ({
      id: model.id,
      providerId: model.providerId,
      providerName: providerNameById.get(model.providerId) ?? model.providerId,
      modelName: model.modelName,
    }))
}

/**
 * 按供应商分组，保持原有顺序。
 *
 * 不排序：候选的顺序来自服务端返回的模型列表，改一次顺序就等于每次打开弹窗都要重新
 * 找一遍刚才看到的那一条。分组只影响显示，不影响选择。
 */
export function groupCandidatesByProvider(candidates: readonly ProviderModelCandidate[]): Array<[string, ProviderModelCandidate[]]> {
  const groups = new Map<string, ProviderModelCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.providerName) ?? []
    group.push(candidate)
    groups.set(candidate.providerName, group)
  }
  return [...groups.entries()]
}

/** 候选的模糊匹配。拼上 id 是为了能按 `pm_` 前缀直接搜到某一条。 */
export function filterCandidates(groups: ReadonlyArray<[string, ProviderModelCandidate[]]>, keyword: string): Array<[string, ProviderModelCandidate[]]> {
  const query = keyword.trim().toLowerCase()
  if (!query) return [...groups]
  return groups
    .map(([providerName, models]): [string, ProviderModelCandidate[]] => [
      providerName,
      models.filter(model => `${providerName} ${model.modelName} ${model.id}`.toLowerCase().includes(query)),
    ])
    .filter(([, models]) => models.length > 0)
}

/**
 * 拉取这个逻辑模型可以加入的候选。
 *
 * 三个请求必须一起成功：少了供应商就拼不出名字，少了已有绑定就算不出「还没绑的是哪些」。
 * 所以这里 `Promise.all` 而不是各自吞掉错误——半个候选集比一次明确的失败更危险。
 */
export async function loadProviderModelCandidates(logicalModelRecordId: string): Promise<ProviderModelCandidate[]> {
  const [providers, models, policies] = await Promise.all([
    unwrap(providerApi.list()),
    unwrap(providerModelApi.list()),
    unwrap(schedulingPolicyApi.list(logicalModelRecordId)),
  ])
  return buildProviderModelCandidates({
    providers,
    models,
    boundProviderModelIds: policies.map(policy => policy.providerModelId),
  })
}

/**
 * 把选中的候选追加到这个逻辑模型的绑定里。
 *
 * 优先级从 `existingCount + 1` 开始递增：调度按优先级从小到大命中，追加在末尾意味着
 * 新加的模型不会挤掉任何已有绑定。`existingCount` 由调用方给出（就是当前绑定的条数），
 * 因为「现在有几条」是页面的现状，不是这次动作能推出来的。
 */
export async function appendProviderModelBindings(logicalModelRecordId: string, providerModelIds: readonly string[], existingCount: number): Promise<void> {
  await Promise.all(providerModelIds.map((providerModelId, index) => unwrap(schedulingPolicyApi.update({
    logicalModelId: logicalModelRecordId,
    providerModelId,
    priority: existingCount + index + 1,
    enabled: true,
  }))))
}
