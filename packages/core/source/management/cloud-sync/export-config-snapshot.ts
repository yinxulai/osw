import type { ConfigSnapshot, ConfigSnapshotSecret } from '@common/cloud-sync'
import { CONFIG_SNAPSHOT_FORMAT, CONFIG_SNAPSHOT_VERSION } from '@common/cloud-sync'
import { listLogicalModels, listSchedulingPolicies } from '@server/database/logical-model-store'
import { listProviderModels } from '@server/database/model-store'
import { listProviders } from '@server/database/provider-store'
import { exportProviderBundle } from '../provider-transfer/export-provider-bundle'
import { encodeSecret } from './secret-codec'

export interface ConfigSnapshotExportResult {
  snapshot: ConfigSnapshot
  /** 序列化后的快照正文，直接作为远端文件内容写入。 */
  content: string
}

/**
 * 把本机配置整理成一份可传输的快照。
 *
 * **密钥一起走，但只做 base64。** 不同步密钥的话，「换台机器点一次拉取就能接着用」只成立一半：
 * 渠道都在，每一个还得重新去官网签一次 Key。所以密钥随快照走，代价是它落到了第三方手里——
 * 因此只给编码不给明文，并且这件事必须在界面上说清楚（见 `docs/product/cloud-sync.md`）。
 *
 * 密钥单独放在 `secrets` 里、`providers` 保持脱敏：两件事分开写，读的人一眼就知道哪个是秘密。
 * 供应商部分直接复用供应商导出（同一份 schema、同一套规则），这里只额外补上供应商导出没有的
 * 维度：逻辑模型本身，以及「哪个供应商的哪个模型挂在哪个逻辑模型上」。
 */
export async function exportConfigSnapshot(): Promise<ConfigSnapshotExportResult> {
  // 供应商导出自己支持带明文密钥，借它把密钥取出来，随即搬进 `secrets` 并从条目里抹掉。
  const { bundle } = await exportProviderBundle({ includeApiKeys: true })
  const secrets: ConfigSnapshotSecret[] = []
  const snapshotProviders = bundle.providers.map(entry => {
    const { apiKey, ...rest } = entry
    // 供应商导出在没取到密钥时会省掉整个字段，所以这里只可能是「没有」或者一个非空串。
    if (apiKey) secrets.push({ providerName: entry.name, value: encodeSecret(apiKey) })
    return rest
  })
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
    providers: snapshotProviders,
    secrets,
    logicalModels: logicalModels.map(model => ({
      id: model.id,
      name: model.name,
      description: model.description,
      enabled: model.enabled,
    })),
    bindings,
  }

  return { snapshot, content: JSON.stringify(snapshot, null, 2) }
}
