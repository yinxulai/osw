import { CONFIG_SNAPSHOT_FILE_NAME, ConfigSnapshotSchema } from '@common/cloud-sync'
import type { ConfigSnapshot } from '@common/cloud-sync'
import { PROVIDER_BUNDLE_FORMAT, PROVIDER_BUNDLE_VERSION } from '@common/provider-bundle'
import { AppError } from '@server/errors'
import {
  createLogicalModel,
  deleteSchedulingPolicy,
  listLogicalModels,
  listSchedulingPolicies,
  reorderLogicalModels,
  updateLogicalModel,
  upsertSchedulingPolicy,
} from '@server/database/logical-model-store'
import { listProviderModels } from '@server/database/model-store'
import { listProviders } from '@server/database/provider-store'
import { importProviderBundle } from '../provider-transfer/import-provider-bundle'

export interface ConfigSnapshotImportResult {
  /** 这份快照是什么时候导出的，用来告诉用户拉回来的是哪一版。 */
  exportedAt: number
  imported: { providers: number; models: number; logicalModels: number; bindings: number }
}

/**
 * 应用一份配置快照。
 *
 * 语义是**快照对它指名道姓的东西说了算**，而不是「清空重来」：
 *
 * - 供应商按名称覆盖，并沿用供应商导入自己的规则（包内未提到的模型软删除）；
 * - 逻辑模型按 **modelId** 新建或更新，快照里没有的逻辑模型**不动**——从一个只同步了部分内容的
 *   快照推回来不该删掉本机多出来的东西；
 * - 绑定只对快照里出现过的逻辑模型重写：这些逻辑模型上的绑定以快照为准（多出来的软删除），
 *   其余逻辑模型的绑定原样保留。
 *
 * 后两条的取舍和供应商包是一致的：把一个供应商从队列里移掉要能同步过去，但对快照没提到的
 * 对象动刀就不是同步而是删除了。代价是「删掉一个逻辑模型」这个动作不会传播，见
 * `docs/product/cloud-sync.md`。
 */
export async function importConfigSnapshot(input: unknown): Promise<ConfigSnapshotImportResult> {
  const snapshot = parseConfigSnapshot(input)

  if (snapshot.providers.length > 0) {
    await importProviderBundle({
      bundle: {
        format: PROVIDER_BUNDLE_FORMAT,
        version: PROVIDER_BUNDLE_VERSION,
        exportedAt: snapshot.exportedAt,
        providers: snapshot.providers,
      },
    })
  }

  const recordIdByModelId = await applyLogicalModels(snapshot)
  const bindings = await applyBindings(snapshot, recordIdByModelId)

  return {
    exportedAt: snapshot.exportedAt,
    imported: {
      providers: snapshot.providers.length,
      models: snapshot.providers.reduce((total, provider) => total + provider.models.length, 0),
      logicalModels: snapshot.logicalModels.length,
      bindings,
    },
  }
}

/**
 * 单独一层校验，只为了给一句能照做的报错。
 *
 * 直接抛 `ConfigSnapshotSchema.parse` 的 Zod 错误，用户看到的是「某个字段不合法」，
 * 但真正的问题是「这不是一份配置快照」——先说清楚这一点，再说哪个字段不对。
 */
function parseConfigSnapshot(input: unknown): ConfigSnapshot {
  const parsed = ConfigSnapshotSchema.safeParse(input)
  if (parsed.success) return parsed.data
  const detail = parsed.error.errors.slice(0, 3).map(issue => `${issue.path.join('.') || 'root'} ${issue.message}`).join('; ')
  throw new AppError('VALIDATION_ERROR', 400, `Not a recognizable config snapshot (expected ${CONFIG_SNAPSHOT_FILE_NAME}): ${detail}`, {
    cause: parsed.error,
  })
}

/**
 * 按 **modelId** 建/改逻辑模型。
 *
 * modelId 是模型的身份（请求按它匹配、快照按它指认），数据记录 id 则是本机生成的内部主键，
 * 两台机器上必然不同 —— 所以这里既不能用本机的记录 id 去认快照里的条目，也不能把快照里的
 * 模型名直接当主键写进库，只能「按名字找、找不到就建一条，建完拿回新的记录 id」。
 *
 * 软删除会把模型名改写成墓碑，所以「快照带回了本机刚删掉的名字」在库里就只是
 * 「这个名字现在没被占用」——按名字查一次就够，不需要再区分「恢复」与「新建」。
 *
 * 返回 modelId → 数据记录 id 的映射：绑定表按记录 id 落库，需要这份翻译。
 */
async function applyLogicalModels(snapshot: ConfigSnapshot): Promise<Map<string, string>> {
  const recordIdByModelId = new Map<string, string>()
  for (const model of await listLogicalModels()) recordIdByModelId.set(model.modelId, model.id)
  // 不提前返回：即使快照一份逻辑模型都没带，这份翻译表也要按本机现状建好 ——
  // 绑定可能指着本机已有（而快照 `logicalModels` 里没重复列出）的模型，那时它仍然要能落库。
  if (snapshot.logicalModels.length === 0) return recordIdByModelId

  // 顺序是快照要传递的语义之一，得按快照自己的次序攒记录 id（新建的会追加到末尾），最后整体重排。
  const orderedRecordIds: string[] = []
  for (const entry of snapshot.logicalModels) {
    const existingRecordId = recordIdByModelId.get(entry.modelId)
    if (existingRecordId === undefined) {
      const created = await createLogicalModel({ modelId: entry.modelId, description: entry.description, enabled: entry.enabled })
      recordIdByModelId.set(created.modelId, created.id)
      orderedRecordIds.push(created.id)
      continue
    }
    await updateLogicalModel(existingRecordId, { description: entry.description, enabled: entry.enabled })
    orderedRecordIds.push(existingRecordId)
  }
  await reorderLogicalModels(orderedRecordIds)
  return recordIdByModelId
}

/**
 * 按快照重写绑定。
 *
 * 绑定表的外键是**数据记录 id**，而快照里写的是模型名，两者之间必须过一次翻译：
 * 快照里提到一个本机不存在的模型名时只能跳过 —— 覆盖它无从谈起，也不能凭空造一条逻辑模型
 * 出来（那会变成「导入顺便帮你建了个模型」，是另一件事）。
 *
 * 翻译表就在 `applyLogicalModels` 的返回值里，不重新查一次库，避免刚建的条目还没进索引。
 */
async function applyBindings(snapshot: ConfigSnapshot, recordIdByModelId: ReadonlyMap<string, string>): Promise<number> {
  // 供应商导入可能新建了供应商与模型，因此索引必须在它之后重建。
  const providerNameById = new Map((await listProviders()).map(provider => [provider.id, provider.name]))
  const modelByIdentity = new Map<string, { id: string; enabled: boolean }>()
  for (const model of await listProviderModels()) {
    const providerName = providerNameById.get(model.providerId)
    if (!providerName) continue
    modelByIdentity.set(bindingKey(providerName, model.modelName), { id: model.id, enabled: model.enabled })
  }

  const wantedByLogicalModel = new Map<string, Set<string>>()
  let written = 0
  for (const binding of snapshot.bindings) {
    const target = modelByIdentity.get(bindingKey(binding.providerName, binding.modelName))
    // 快照里提到一个本地不存在的模型，只能是快照自身不一致（绑定指向了没在 `providers` 里的模型）。
    // 这种情况下跳过而不是造一个空模型出来。
    if (!target) continue
    const logicalModelRecordId = recordIdByModelId.get(binding.modelId)
    if (logicalModelRecordId === undefined) continue
    // 模型本体被停用时绑定不可能生效（`upsertSchedulingPolicy` 也会拒绝），
    // 所以落库时按「两个都开着才算开」算，而不是让整次导入失败在一个必然矛盾的条目上。
    await upsertSchedulingPolicy({
      logicalModelId: logicalModelRecordId,
      providerModelId: target.id,
      priority: binding.priority,
      enabled: binding.enabled && target.enabled,
    })
    written += 1
    const wanted = wantedByLogicalModel.get(logicalModelRecordId) ?? new Set<string>()
    wanted.add(target.id)
    wantedByLogicalModel.set(logicalModelRecordId, wanted)
  }

  // 快照覆盖到的逻辑模型上，没被提到的绑定就撤掉：把一个模型从队列里移除是常见的编辑动作，
  // 它必须能同步过去。未出现在快照里的逻辑模型完全不碰（见函数头注释）。
  for (const [logicalModelRecordId, wanted] of Array.from(wantedByLogicalModel.entries())) {
    for (const policy of await listSchedulingPolicies(logicalModelRecordId)) {
      if (wanted.has(policy.providerModelId)) continue
      await deleteSchedulingPolicy(logicalModelRecordId, policy.providerModelId)
    }
  }

  return written
}

/** 用 `\0` 分隔而不是 `:` 或 `/`：供应商名与模型名都可能含冒号与斜杠（Azure 部署名、带斜杠的模型 id）。 */
function bindingKey(providerName: string, modelName: string): string {
  return `${providerName}\u0000${modelName}`
}
