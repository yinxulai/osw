import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { ProviderEndpointSchema, ProviderSchema, ProviderSettingSchema } from '@common/schemas'
import type { Provider, ProviderEndpoint, ProviderSetting } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import {
  providerEndpoints,
  providerHealth,
  providerModelEndpoints,
  providerModels,
  protocolConverters,
  providerSettings,
  providers,
} from './schema'

export async function listProviders(includeDeleted = false): Promise<Provider[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db.select().from(providers).orderBy(desc(providers.createdTime)).all()
    : db.select().from(providers).where(isNull(providers.deletedTime)).orderBy(desc(providers.createdTime)).all()
  return rows.map(mapProvider)
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const row = getDb().select().from(providers).where(eq(providers.id, id)).get()
  return row ? mapProvider(row) : undefined
}

type CreateProviderInput = { name: string; description?: string; apiKeyReference: string; timeoutMilliseconds?: number; enabled?: boolean }

export async function createProvider(input: CreateProviderInput): Promise<Provider> {
  const id = generateId('prov_')
  const time = now()
  const db = getDb()
  const provider = ProviderSchema.parse({ ...input, description: input.description ?? '', id, createdTime: time, updatedTime: time, deletedTime: null })
  db.insert(providers).values({ id, name: provider.name, description: provider.description ?? '', enabled: provider.enabled, createdTime: time, updatedTime: time }).run()
  db.insert(providerSettings).values([
    { providerId: id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: time },
    { providerId: id, key: 'connection.timeoutMilliseconds', value: String(provider.timeoutMilliseconds), valueType: 'number', updatedTime: time },
  ]).run()
  db.insert(providerHealth).values({ providerId: id, consecutiveFailures: 0, updatedTime: time }).run()
  return provider
}

export async function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Promise<Provider> {
  const db = getDb()
  const time = now()
  const existing = db.select().from(providers).where(eq(providers.id, id)).get()
  if (!existing) throw new Error(`provider not found: ${id}`)
  const next = ProviderSchema.parse({ ...mapProvider(existing), ...updates, id, createdTime: Number(existing.createdTime), updatedTime: time })
  db.update(providers).set({ name: next.name, description: next.description ?? '', enabled: next.enabled, updatedTime: time, deletedTime: next.deletedTime }).where(and(eq(providers.id, id), isNull(providers.deletedTime))).run()
  for (const [key, value, valueType] of [
    ['security.secretReference', next.apiKeyReference, 'string'],
    ['connection.timeoutMilliseconds', String(next.timeoutMilliseconds), 'number'],
  ] as const) {
    db.insert(providerSettings).values({ providerId: id, key, value, valueType, updatedTime: time }).onConflictDoUpdate({
      target: [providerSettings.providerId, providerSettings.key], set: { value, valueType, updatedTime: time },
    }).run()
  }
  return next
}

export async function listProviderSettings(providerId: string): Promise<ProviderSetting[]> {
  return getDb().select().from(providerSettings).where(eq(providerSettings.providerId, providerId)).orderBy(providerSettings.key).all().map(row => ProviderSettingSchema.parse({ ...row, updatedTime: Number(row.updatedTime) }))
}

export async function getProviderSetting(providerId: string, key: string): Promise<ProviderSetting | undefined> {
  const row = getDb().select().from(providerSettings).where(and(eq(providerSettings.providerId, providerId), eq(providerSettings.key, key))).get()
  return row ? ProviderSettingSchema.parse({ ...row, updatedTime: Number(row.updatedTime) }) : undefined
}

export async function upsertProviderSetting(input: Omit<ProviderSetting, 'updatedTime'>): Promise<ProviderSetting> {
  const setting = ProviderSettingSchema.parse({ ...input, updatedTime: now() })
  getDb().insert(providerSettings).values(setting).onConflictDoUpdate({
    target: [providerSettings.providerId, providerSettings.key], set: { value: setting.value, valueType: setting.valueType, updatedTime: setting.updatedTime },
  }).run()
  return setting
}

export async function deleteProviderSetting(providerId: string, key: string): Promise<void> {
  getDb().delete(providerSettings).where(and(eq(providerSettings.providerId, providerId), eq(providerSettings.key, key))).run()
}

export async function listProviderEndpoints(providerId: string): Promise<ProviderEndpoint[]> {
  return getDb().select().from(providerEndpoints).where(eq(providerEndpoints.providerId, providerId)).orderBy(providerEndpoints.protocol).all().map(row => ({
    ...row, protocol: row.protocol as ProviderEndpoint['protocol'], createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime),
  }))
}

export async function getProviderEndpoint(id: string): Promise<ProviderEndpoint | undefined> {
  const row = getDb().select().from(providerEndpoints).where(eq(providerEndpoints.id, id)).get()
  return row ? ProviderEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) }) : undefined
}

type CreateProviderEndpointInput = Omit<ProviderEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'enabled'> & { enabled?: boolean }

export async function createProviderEndpoint(input: CreateProviderEndpointInput): Promise<ProviderEndpoint> {
  const time = now()
  const endpoint = ProviderEndpointSchema.parse({ ...input, id: generateId('end_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(providerEndpoints).values(endpoint).run()
  return endpoint
}

export async function updateProviderEndpoint(id: string, updates: Partial<Pick<ProviderEndpoint, 'protocol' | 'url' | 'enabled'>>): Promise<ProviderEndpoint> {
  const existing = await getProviderEndpoint(id)
  if (!existing) throw new Error(`provider endpoint not found: ${id}`)
  const endpoint = ProviderEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(providerEndpoints).set({ protocol: endpoint.protocol, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime }).where(eq(providerEndpoints.id, id)).run()
  return endpoint
}

export async function deleteProviderEndpoint(id: string): Promise<void> {
  const db = getDb()
  db.transaction(transaction => {
    const bindings = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints).where(eq(providerModelEndpoints.providerEndpointId, id)).all()
    if (bindings.length > 0) {
      const bindingIds = bindings.map(binding => binding.id)
      transaction.delete(protocolConverters).where(inArray(protocolConverters.providerModelEndpointId, bindingIds)).run()
      transaction.delete(providerModelEndpoints).where(inArray(providerModelEndpoints.id, bindingIds)).run()
    }
    transaction.delete(providerEndpoints).where(eq(providerEndpoints.id, id)).run()
  })
}

export async function replaceProviderEndpoints(providerId: string, endpoints: Partial<Record<ProviderEndpoint['protocol'], string>>): Promise<ProviderEndpoint[]> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    transaction.update(providerEndpoints).set({ enabled: false, updatedTime: time }).where(eq(providerEndpoints.providerId, providerId)).run()
    for (const [protocol, url] of Object.entries(endpoints)) {
      if (!url?.trim()) continue
      transaction.insert(providerEndpoints).values({ id: generateId('end_'), providerId, protocol, url: url.trim(), enabled: true, createdTime: time, updatedTime: time }).onConflictDoUpdate({
        target: [providerEndpoints.providerId, providerEndpoints.protocol], set: { url: url.trim(), enabled: true, updatedTime: time },
      }).run()
    }
  })
  return listProviderEndpoints(providerId)
}

export async function deleteProvider(id: string): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    transaction.update(providers).set({ deletedTime: time, updatedTime: time }).where(and(eq(providers.id, id), isNull(providers.deletedTime))).run()
    transaction.update(providerModels).set({ enabled: false, updatedTime: time, deletedTime: time }).where(and(eq(providerModels.providerId, id), isNull(providerModels.deletedTime))).run()
  })
}

function mapProvider(row: typeof providers.$inferSelect): Provider {
  const settingRows = getDb().select().from(providerSettings).where(eq(providerSettings.providerId, row.id)).all()
  const values = new Map(settingRows.map(setting => [setting.key, setting.value]))
  return {
    id: row.id, name: row.name, description: row.description, apiKeyReference: values.get('security.secretReference') ?? '',
    timeoutMilliseconds: Number(values.get('connection.timeoutMilliseconds') ?? 30000), enabled: row.enabled,
    queueGroupEnabled: values.get('queue.groupEnabled') === 'true',
    createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime), deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}
