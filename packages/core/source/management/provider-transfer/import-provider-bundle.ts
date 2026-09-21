import { generateKeyReference } from '@common/secret-store'
import { ProviderBundleImportRequestSchema } from '@common/provider-bundle'
import type { ProviderBundleImportRequest, ProviderBundleModel, ProviderBundleProvider, ProviderBundleSetting } from '@common/provider-bundle'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { AppError } from '@server/errors'
import { upsertSchedulingPolicy } from '@server/database/logical-model-store'
import { createProviderModelRoute, deleteProviderModelRoute, listProviderModels, updateProviderModelRoute } from '@server/database/model-store'
import {
  createProvider,
  deleteProviderSetting,
  listProviderSettings,
  listProviders,
  replaceProviderEndpointStates,
  updateProvider,
  upsertProviderSetting,
} from '@server/database/provider-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { reportTelemetryEvent } from '@server/telemetry'
import { MANAGED_PROVIDER_SETTING_KEYS } from './export-provider-bundle'

export interface ProviderBundleImportResult {
  imported: { providers: number; models: number }
}

/**
 * `initDatabases` 会保证 `default` 逻辑模型存在，与「新建供应商模型」接口的默认归属一致。
 *
 * 调度位置（挂在哪个逻辑模型、优先级、权重）属于逻辑模型域，不在供应商包里；但如果不给新建的
 * 模型建策略，搬过来的供应商就会变成一个不参与任何路由的空壳。所以新建的模型按手工新建的默认
 * 行为挂到 `default`，已有模型的调度位置则完全不动。
 */

/**
 * 导入供应商包。
 *
 * 语义是**整体覆盖**而不是合并：包里的内容就是该供应商导入后的全部状态，因此按名称匹配到已有
 * 供应商时，包里没提到的端点、自定义设置和模型都会被清掉。否则「导出再导入」会不断累积残留，
 * 而用户以为自己还原了一个已知状态——这正是导入导出最该避免的意外。
 *
 * 唯一被刻意保留的是密钥：包里有 `apiKey` 就写回，没有就沿用目标环境已有的密钥，这样
 * 「导出时不带明文」的包在源机器上重新导入也不会把凭据抹掉。新供应商没有密钥时留空，
 * 用户在供应商详情里补填即可。
 *
 * 包内数据在写入前全部校验（含重名检查），因此这里的失败只可能来自数据库本身；不做跨表事务是
 * 既有 store 的边界（每个 store 函数各管自己的事务），代价是极端情况下会留下一个半导入的供应商。
 *
 * 埋点与手工新建同一个口径**只算真的新建出来的东西**（`provider_created` / `model_created`）：
 * 按名覆盖已有供应商走的是另一条分支，它是一次更新，不是「建出来了」。导入的来源只有 `custom`
 * 一档——包里的内容不是从内置预设界面上起手的，包本身也没地方装这个事实。
 */
export async function importProviderBundle(body: unknown): Promise<ProviderBundleImportResult> {
  const { bundle } = parseImportRequest(body)
  assertUniqueProviderNames(bundle.providers)

  const secretStore = getSecretStore()
  const activeProviders = await listProviders(false)
  let providers = 0
  let models = 0

  for (const entry of bundle.providers) {
    const existing = activeProviders.find(provider => provider.name === entry.name)
    if (existing) {
      if (entry.apiKey !== undefined) await secretStore.set(existing.apiKeyReference, entry.apiKey)
      await updateProvider(existing.id, {
        name: entry.name,
        description: entry.description,
        enabled: entry.enabled,
        timeoutMilliseconds: entry.timeoutMilliseconds,
      })
      await applyProviderDetail(existing.id, entry)
    } else {
      const apiKeyReference = generateKeyReference()
      if (entry.apiKey !== undefined) await secretStore.set(apiKeyReference, entry.apiKey)
      const created = await createProvider({
        name: entry.name,
        description: entry.description,
        apiKeyReference,
        timeoutMilliseconds: entry.timeoutMilliseconds,
        enabled: entry.enabled,
      })
      // 只在地还没有这个供应商」时发：上面那条分支按名覆盖的是既有记录，不是新建。
      // 位置就在行落库之后、细节之前，因此事件流里的次序就是「先供应商、后它的模型」。
      reportTelemetryEvent({ name: 'provider_created', kind: 'custom' })
      await applyProviderDetail(created.id, entry)
    }
    providers += 1
    models += entry.models.length
  }

  return { imported: { providers, models } }
}

/** 先用 Zod 校验外壳，把「这根本不是供应商包」和「包里某个字段不合法」区分开，前者要给出人话。 */
function parseImportRequest(body: unknown): ProviderBundleImportRequest {
  const parsed = ProviderBundleImportRequestSchema.safeParse(body)
  if (parsed.success) return parsed.data

  const issues = parsed.error.errors.map(issue => `${issue.path.join('.') || 'bundle'} ${issue.message}`).join('；')
  throw new AppError('VALIDATION_ERROR', 400, `Not a recognizable provider export file: ${issues}`)
}

function assertUniqueProviderNames(providers: ProviderBundleProvider[]): void {
  const names = new Set<string>()
  for (const provider of providers) {
    if (names.has(provider.name)) throw new AppError('DUPLICATE_RESOURCE', 400, `Duplicate provider in the export file: ${provider.name}`, { details: { providerName: provider.name } })
    names.add(provider.name)
  }
}

async function applyProviderDetail(providerId: string, entry: ProviderBundleProvider): Promise<void> {
  // 端点先落库：模型侧保存时要能拿到地址，否则包里「没写地址」的模型会被判成无地址而拒绝。
  // 这次调用带 `allowDetachingModels`——同一个包里连模型一起换掉了，不存在「只改了供应商」的错觉。
  await replaceProviderEndpointStates(providerId, entry.endpoints, { allowDetachingModels: true })
  await applySettings(providerId, entry.settings)
  await applyModels(providerId, entry.models)
}

/** 自定义设置整体替换：包里没有的 key 删除；托管 key 由 store 维护，不参与导入。 */
async function applySettings(providerId: string, settings: ProviderBundleSetting[]): Promise<void> {
  const bundledKeys = new Set(settings.map(setting => setting.key))
  for (const setting of settings) {
    await upsertProviderSetting({ providerId, key: setting.key, value: setting.value, valueType: setting.valueType })
  }
  for (const existing of await listProviderSettings(providerId)) {
    if (MANAGED_PROVIDER_SETTING_KEYS.includes(existing.key)) continue
    if (bundledKeys.has(existing.key)) continue
    await deleteProviderSetting(providerId, existing.key)
  }
}

/** 模型整体替换：按 `modelName` 匹配，包里没有的模型软删除。 */
async function applyModels(providerId: string, models: ProviderBundleModel[]): Promise<void> {
  const existing = (await listProviderModels(false)).filter(model => model.providerId === providerId)
  const bundledNames = new Set(models.map(model => model.modelName))

  for (const model of models) {
    const endpoints = model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      // 空串代表「沿用供应商端点地址」；store 会把它落成绑定上的 null，语义与原值一致。
      endpointUrl: endpoint.url ?? '',
      customAuthHeader: null,
      protocolConversionEnabled: endpoint.protocolConversionEnabled,
    }))
    const matched = existing.find(candidate => candidate.modelName === model.modelName)
    if (matched) {
      await updateProviderModelRoute(matched.id, { enabled: model.enabled, endpoints })
    } else {
      // priority 属于调度策略（`scheduling_policies.priority`），不属于供应商包，这里只占位。
      // 绑定开关跟随模型本体的开关：包里带着停用模型时，不能顺手建一条打开的绑定。
      const created = await createProviderModelRoute({ providerId, modelName: model.modelName, enabled: model.enabled, endpoints, priority: 0 })
      await upsertSchedulingPolicy({ logicalModelId: BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME, providerModelId: created.id, priority: 0, enabled: created.enabled })
      // 与手工新建同一个口径：一条端点绑定算一次「这类能力被接进来」（见 `model_created` 的契约注释）。
      // 同一个包的模型名与本地对得上时走的是上面的复用分支，那条不发。
      for (const endpoint of endpoints) reportTelemetryEvent({ name: 'model_created', protocol: endpoint.protocol })
    }
  }

  for (const model of existing) {
    if (!bundledNames.has(model.modelName)) await deleteProviderModelRoute(model.id)
  }
}
