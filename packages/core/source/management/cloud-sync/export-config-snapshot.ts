import type { ConfigSnapshot } from '@common/cloud-sync'
import { CONFIG_SNAPSHOT_FORMAT, CONFIG_SNAPSHOT_VERSION } from '@common/cloud-sync'
import { listLogicalModels, listSchedulingPolicies } from '@server/database/logical-model-store'
import { listProviderModels } from '@server/database/model-store'
import { listProviders } from '@server/database/provider-store'
import { exportProviderBundle } from '../provider-transfer/export-provider-bundle'
import { encodeSnapshotDocument } from './snapshot-codec'

export interface ConfigSnapshotExportResult {
  snapshot: ConfigSnapshot
  /** 写进远端文件的内容：整份快照 JSON 的 base64（见 `snapshot-codec.ts`）。 */
  content: string
}

/**
 * 把本机配置整理成一份可传输的快照。
 *
 * **整份正文 base64 后才写出去**（见 `snapshot-codec.ts`）：远端那个文件由第三方托管，
 * 而快照里既有用户的部署信息，也有各供应商的 API Key。编码让这个文件一眼看不出内容，
 * 但它只是编码——拿到文件的人解一下就还原了全部，包括密钥。
 *
 * 因此密钥是**带着走**的：不带的话「换台机器点一次拉取就能接着用」只成立一半——渠道都在，
 * 每一个还得重新去官网签一次 Key。代价是密钥落到了托管方手里，所以这件事在界面上与
 * `docs/product/cloud-sync.md` 里都写明了，不能只藏在代码里。
 *
 * 供应商部分直接复用供应商导出（同一份 schema、同一套规则，只是这里带上密钥），这里只额外补上
 * 供应商导出没有的维度：逻辑模型本身，以及「哪个供应商的哪个模型挂在哪个逻辑模型上」。
 */
export async function exportConfigSnapshot(): Promise<ConfigSnapshotExportResult> {
  const { bundle } = await exportProviderBundle({ includeApiKeys: true })
  const [logicalModels, providers, providerModels, policies] = await Promise.all([
    listLogicalModels(),
    listProviders(),
    listProviderModels(),
    listSchedulingPolicies(),
  ])

  // 绑定在快照里用「供应商名 + 模型名」指代：本机主键（`prov_*` / 模型 id）换台机器必然不同，
  // 只有这个组合是跨机稳定的。
  const providerNameById = new Map(providers.map(provider => [provider.id, provider.name]))
  const modelIdentityById = new Map(providerModels.map(model => [
    model.id,
    { providerName: providerNameById.get(model.providerId) ?? '', modelName: model.modelName },
  ]))

  const bindings = policies.flatMap(policy => {
    const identity = modelIdentityById.get(policy.providerModelId)
    // 供应商或模型已被删除时绑定会指向不存在的行：这种绑定没有可传输的语义，跳过而不是写一个空名字。
    if (!identity || identity.providerName.length === 0) return []
    return [{
      logicalModelId: policy.logicalModelId,
      providerName: identity.providerName,
      modelName: identity.modelName,
      priority: policy.priority,
      enabled: policy.enabled,
    }]
  })

  const snapshot: ConfigSnapshot = {
    format: CONFIG_SNAPSHOT_FORMAT,
    version: CONFIG_SNAPSHOT_VERSION,
    exportedAt: Date.now(),
    providers: bundle.providers,
    logicalModels: logicalModels.map(model => ({
      id: model.id,
      name: model.name,
      description: model.description,
      enabled: model.enabled,
    })),
    bindings,
  }

  // 不缩进：整份正文马上就要 base64，缩进只会把远端文件白撑大一圈而没人会直接读它。
  return { snapshot, content: encodeSnapshotDocument(JSON.stringify(snapshot)) }
}
