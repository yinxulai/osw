import { generateKeyReference } from '@common/keychain'
import type { Protocol, ProviderModelRouteEndpoint } from '@common/schemas'
import {
  createProvider,
  deleteProvider as deleteProviderRecord,
  getProviderSetting,
  listProviders,
  replaceProviderEndpoints,
  upsertProviderSetting,
} from '@server/database/provider-store'
import {
  createProviderModelRoute,
  deleteProviderModelRoute,
  listProviderModelRoutesByProvider,
} from '@server/database/model-store'
import {
  deleteSchedulingPolicy,
  listSchedulingPolicies,
  upsertSchedulingPolicy,
} from '@server/database/logical-model-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { getFreeModelSource } from './registry'
import type { FreeModelSource, FreeModelSyncResult, FreeModelSyncState } from './types'

const SOURCE_MARKER_KEY = 'freeModel.source'
const SYNC_STATE_KEY = 'freeModel.syncState'
const DEFAULT_LOGICAL_MODEL = 'default'

/** 标记某个 provider 由哪个免费模型源管理 */
export async function markProviderSource(providerId: string, sourceKey: string): Promise<void> {
  await upsertProviderSetting({ providerId, key: SOURCE_MARKER_KEY, value: sourceKey, valueType: 'string' })
}

/** 找到某个源当前托管的 provider（未找到返回 null） */
export async function findManagedProvider(sourceKey: string): Promise<{ id: string; name: string } | null> {
  const providers = await listProviders(false)
  for (const provider of providers) {
    const marker = await getProviderSetting(provider.id, SOURCE_MARKER_KEY)
    if (marker?.value === sourceKey) return { id: provider.id, name: provider.name }
  }
  return null
}

/** 读取某个源托管 provider 的最近同步状态 */
export async function getSourceSyncState(providerId: string): Promise<FreeModelSyncState | null> {
  const setting = await getProviderSetting(providerId, SYNC_STATE_KEY)
  if (!setting) return null
  try {
    return JSON.parse(setting.value) as FreeModelSyncState
  } catch {
    return null
  }
}

async function writeSyncState(providerId: string, state: FreeModelSyncState): Promise<void> {
  await upsertProviderSetting({ providerId, key: SYNC_STATE_KEY, value: JSON.stringify(state), valueType: 'json' })
}

function buildModelEndpoints(source: FreeModelSource): ProviderModelRouteEndpoint[] {
  return (Object.keys(source.endpoints) as Protocol[]).map(protocol => ({
    protocol,
    endpointUrl: '',
    customAuthHeader: null,
    protocolConversionEnabled: false,
  }))
}

/**
 * 确保源对应的托管 provider 存在且端点/密钥已就绪。
 * 返回 provider id。
 */
export async function ensureManagedProvider(source: FreeModelSource, apiKey?: string): Promise<string> {
  const secretStore = getSecretStore()
  const existing = await findManagedProvider(source.key)
  if (existing) {
    if (apiKey) {
      const providers = await listProviders(false)
      const provider = providers.find(candidate => candidate.id === existing.id)
      if (provider) await secretStore.set(provider.apiKeyReference, apiKey)
    }
    await replaceProviderEndpoints(existing.id, source.endpoints)
    return existing.id
  }

  const apiKeyReference = generateKeyReference()
  if (apiKey) await secretStore.set(apiKeyReference, apiKey)
  const provider = await createProvider({ name: source.providerName, apiKeyReference, enabled: true })
  await replaceProviderEndpoints(provider.id, source.endpoints)
  await markProviderSource(provider.id, source.key)
  return provider.id
}

/** 停用源：软删除其托管的 provider 与密钥，并清理调度策略 */
export async function removeManagedProvider(sourceKey: string): Promise<void> {
  const managed = await findManagedProvider(sourceKey)
  if (!managed) return
  const providers = await listProviders(true)
  const provider = providers.find(candidate => candidate.id === managed.id)
  // deleteProvider 会软删 provider 及其模型，但调度策略行需显式移除
  const routes = await listProviderModelRoutesByProvider(managed.id, true)
  for (const route of routes) {
    await deleteSchedulingPolicy(DEFAULT_LOGICAL_MODEL, route.id)
  }
  await deleteProviderRecord(managed.id)
  if (provider) await getSecretStore().delete(provider.apiKeyReference)
}

const inFlight = new Set<string>()

export interface SyncSourceOptions {
  /** 显式传入 API Key（启用/更新密钥时）；不传则使用 provider 已保存的密钥 */
  apiKey?: string
  signal?: AbortSignal
}

/**
 * 同步某个免费模型源：拉取免费模型 → 与现有模型 diff → 增删模型与调度策略。
 * 所有源共用此逻辑，差异仅在 source.fetchFreeModels。
 */
export async function syncFreeModelSource(sourceKey: string, options: SyncSourceOptions = {}): Promise<FreeModelSyncResult> {
  const source = getFreeModelSource(sourceKey)
  if (!source) throw new Error(`未知的免费模型源: ${sourceKey}`)
  if (inFlight.has(sourceKey)) throw new Error('该源正在同步中，请稍后再试')
  inFlight.add(sourceKey)
  const time = Date.now()
  try {
    const providerId = await ensureManagedProvider(source, options.apiKey)

    const providers = await listProviders(false)
    const provider = providers.find(candidate => candidate.id === providerId)
    const apiKey = options.apiKey ?? (provider ? await getSecretStore().get(provider.apiKeyReference) : null)

    const listings = await source.fetchFreeModels({
      apiKey,
      timeoutMilliseconds: provider?.timeoutMilliseconds ?? 30000,
      signal: options.signal,
    })

    const desiredIds = [...new Set(listings.map(listing => listing.id).filter(Boolean))]
    const desiredSet = new Set(desiredIds)
    const existing = await listProviderModelRoutesByProvider(providerId, false)
    const existingByName = new Map(existing.map(route => [route.modelName, route]))

    const policies = await listSchedulingPolicies(DEFAULT_LOGICAL_MODEL)
    let nextPriority = policies.reduce((max, policy) => Math.max(max, policy.priority), 0)
    const endpoints = buildModelEndpoints(source)

    let added = 0
    for (const modelId of desiredIds) {
      if (existingByName.has(modelId)) continue
      const model = await createProviderModelRoute({ providerId, modelName: modelId, endpoints, priority: nextPriority + 1, enabled: true })
      nextPriority += 1
      await upsertSchedulingPolicy({ logicalModelId: DEFAULT_LOGICAL_MODEL, providerModelId: model.id, priority: nextPriority })
      added += 1
    }

    let removed = 0
    for (const route of existing) {
      if (desiredSet.has(route.modelName)) continue
      await deleteProviderModelRoute(route.id)
      await deleteSchedulingPolicy(DEFAULT_LOGICAL_MODEL, route.id)
      removed += 1
    }

    const state: FreeModelSyncState = { time: Date.now(), status: 'success', error: null, added, removed, total: desiredIds.length }
    await writeSyncState(providerId, state)
    console.info(`[free-models] source=${source.key} sync success added=${added} removed=${removed} total=${desiredIds.length} duration=${Date.now() - time}ms`)
    return { providerId, added, removed, total: desiredIds.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const managed = await findManagedProvider(sourceKey).catch(() => null)
    if (managed) {
      const previous = await getSourceSyncState(managed.id).catch(() => null)
      await writeSyncState(managed.id, {
        time: Date.now(),
        status: 'error',
        error: message,
        added: previous?.added ?? 0,
        removed: previous?.removed ?? 0,
        total: previous?.total ?? 0,
      }).catch(() => undefined)
    }
    console.error(`[free-models] source=${source.key} sync failed: ${message}`)
    throw error
  } finally {
    inFlight.delete(sourceKey)
  }
}
