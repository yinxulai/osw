import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { ProtocolConverterSchema, ProviderModelEndpointSchema } from '@common/schemas'
import type {
  ProtocolConverter,
  ProviderModel,
  ProviderModelEndpoint,
  ProviderModelRoute,
  ProviderModelRouteEndpoint,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { getDb } from './index'
import {
  providerEndpoints,
  providerModelEndpoints,
  providerModelHealth,
  providerModels,
  protocolConverters,
  schedulingPolicies,
} from './schema'

export interface ProviderModelEndpointView extends ProviderModelEndpoint {
  protocol: ProviderModelRouteEndpoint['protocol']
  conversions: ProtocolConverter[]
}

export interface ProviderModelView extends ProviderModel {
  endpoints: ProviderModelEndpointView[]
}

export async function listProviderModels(includeDeleted = false): Promise<ProviderModelView[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelView)
}

export async function listProviderModelsForLogicalModel(logicalModelId: string, includeDeleted = false): Promise<ProviderModelRoute[]> {
  const rows = getDb().select({ model: providerModels, policy: schedulingPolicies })
    .from(schedulingPolicies)
    .innerJoin(providerModels, eq(schedulingPolicies.providerModelId, providerModels.id))
    .where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), eq(schedulingPolicies.enabled, true)))
    .orderBy(asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()
  return rows
    .filter(({ model, policy }) => (includeDeleted || model.deletedTime === null) && model.enabled && policy.enabled)
    .map(({ model, policy }) => ({ ...mapProviderModelRoute(model), priority: policy.priority }))
}

export async function getProviderModel(id: string): Promise<ProviderModelView | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelView(row) : undefined
}

export async function listProviderModelRoutesByProvider(providerId: string, includeDeleted = false): Promise<ProviderModelRoute[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? eq(providerModels.providerId, providerId) : and(eq(providerModels.providerId, providerId), isNull(providerModels.deletedTime)))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelRoute)
}

export async function listProviderModelRoutes(includeDeleted = true): Promise<ProviderModelRoute[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelRoute)
}

export async function getProviderModelRoute(id: string): Promise<ProviderModelRoute | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelRoute(row) : undefined
}

type CreateProviderModelRouteInput = Pick<ProviderModelRoute, 'providerId' | 'modelName' | 'priority'> & Partial<Pick<ProviderModelRoute, 'endpoints' | 'enabled'>>

export async function createProviderModelRoute(input: CreateProviderModelRouteInput): Promise<ProviderModelRoute> {
  const id = generateId('model_')
  const time = now()
  const db = getDb()
  db.transaction(transaction => {
    transaction.insert(providerModels).values({ id, providerId: input.providerId, modelName: input.modelName, enabled: input.enabled ?? true, createdTime: time, updatedTime: time }).run()
    transaction.insert(providerModelHealth).values({ providerModelId: id, updatedTime: time }).run()
    replaceRouteEndpoints(transaction, id, input.providerId, input.endpoints ?? [], time)
  })
  return { id, providerId: input.providerId, modelName: input.modelName, endpoints: input.endpoints ?? [], priority: input.priority, enabled: input.enabled ?? true, createdTime: time, updatedTime: time, deletedTime: null }
}

export async function updateProviderModelRoute(id: string, updates: Partial<Omit<ProviderModelRoute, 'id' | 'createdTime'>>): Promise<ProviderModelRoute> {
  const time = now()
  const db = getDb()
  const existing = await getProviderModelRoute(id)
  if (!existing) throw new Error(`provider model not found: ${id}`)
  db.transaction(transaction => {
    transaction.update(providerModels).set({
      ...(updates.providerId !== undefined ? { providerId: updates.providerId } : {}),
      ...(updates.modelName !== undefined ? { modelName: updates.modelName } : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}),
      updatedTime: time,
    }).where(eq(providerModels.id, id)).run()
    if (updates.endpoints !== undefined) {
      transaction.delete(protocolConverters).where(sql`providerModelEndpointId IN (SELECT id FROM provider_model_endpoints WHERE providerModelId = ${id})`).run()
      transaction.delete(providerModelEndpoints).where(eq(providerModelEndpoints.providerModelId, id)).run()
      replaceRouteEndpoints(transaction, id, updates.providerId ?? existing.providerId, updates.endpoints, time)
    }
  })
  return { ...existing, ...updates, id, updatedTime: time }
}

export async function deleteProviderModelRoute(id: string): Promise<void> {
  const time = now()
  getDb().update(providerModels).set({ enabled: false, deletedTime: time, updatedTime: time }).where(and(eq(providerModels.id, id), isNull(providerModels.deletedTime))).run()
}

export async function listProviderModelEndpoints(providerModelId: string): Promise<ProviderModelEndpoint[]> {
  return getDb().select().from(providerModelEndpoints).where(eq(providerModelEndpoints.providerModelId, providerModelId)).orderBy(providerModelEndpoints.createdTime, providerModelEndpoints.id).all().map(parseProviderModelEndpoint)
}

export async function getProviderModelEndpoint(id: string): Promise<ProviderModelEndpoint | undefined> {
  const row = getDb().select().from(providerModelEndpoints).where(eq(providerModelEndpoints.id, id)).get()
  return row ? parseProviderModelEndpoint(row) : undefined
}

type CreateProviderModelEndpointInput = Omit<ProviderModelEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'url' | 'enabled'> & { url?: string | null; enabled?: boolean }

export async function createProviderModelEndpoint(input: CreateProviderModelEndpointInput): Promise<ProviderModelEndpoint> {
  const time = now()
  const endpoint = ProviderModelEndpointSchema.parse({ ...input, id: generateId('pme_'), url: input.url ?? null, enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(providerModelEndpoints).values(endpoint).run()
  return endpoint
}

export async function updateProviderModelEndpoint(id: string, updates: Partial<Pick<ProviderModelEndpoint, 'providerEndpointId' | 'url' | 'enabled'>>): Promise<ProviderModelEndpoint> {
  const existing = await getProviderModelEndpoint(id)
  if (!existing) throw new Error(`provider model endpoint not found: ${id}`)
  const endpoint = ProviderModelEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(providerModelEndpoints).set({ providerEndpointId: endpoint.providerEndpointId, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime }).where(eq(providerModelEndpoints.id, id)).run()
  return endpoint
}

export async function deleteProviderModelEndpoint(id: string): Promise<void> {
  getDb().transaction(transaction => {
    transaction.delete(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, id)).run()
    transaction.delete(providerModelEndpoints).where(eq(providerModelEndpoints.id, id)).run()
  })
}

export async function listProtocolConverters(providerModelEndpointId: string): Promise<ProtocolConverter[]> {
  return getDb().select().from(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId)).orderBy(protocolConverters.createdTime, protocolConverters.id).all().map(parseProtocolConverter)
}

export async function getProtocolConverter(id: string): Promise<ProtocolConverter | undefined> {
  const row = getDb().select().from(protocolConverters).where(eq(protocolConverters.id, id)).get()
  return row ? parseProtocolConverter(row) : undefined
}

type CreateProtocolConverterInput = Omit<ProtocolConverter, 'id' | 'createdTime' | 'updatedTime' | 'enabled'> & { enabled?: boolean }

export async function createProtocolConverter(input: CreateProtocolConverterInput): Promise<ProtocolConverter> {
  const time = now()
  const converter = ProtocolConverterSchema.parse({ ...input, id: generateId('conv_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(protocolConverters).values(converter).run()
  return converter
}

export async function updateProtocolConverter(id: string, updates: Partial<Pick<ProtocolConverter, 'clientProtocol' | 'enabled'>>): Promise<ProtocolConverter> {
  const existing = await getProtocolConverter(id)
  if (!existing) throw new Error(`protocol converter not found: ${id}`)
  const converter = ProtocolConverterSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(protocolConverters).set({ clientProtocol: converter.clientProtocol, enabled: converter.enabled, updatedTime: converter.updatedTime }).where(eq(protocolConverters.id, id)).run()
  return converter
}

export async function deleteProtocolConverter(id: string): Promise<void> {
  getDb().delete(protocolConverters).where(eq(protocolConverters.id, id)).run()
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

function replaceRouteEndpoints(transaction: Transaction, modelId: string, providerId: string, endpoints: ProviderModelRouteEndpoint[], time: number): void {
  for (const endpoint of endpoints) {
    const endpointRow = transaction.select().from(providerEndpoints).where(and(eq(providerEndpoints.providerId, providerId), eq(providerEndpoints.protocol, endpoint.protocol))).get()
    const endpointId = endpointRow?.id ?? generateId('end_')
    if (!endpointRow) transaction.insert(providerEndpoints).values({ id: endpointId, providerId, protocol: endpoint.protocol, url: endpoint.endpointUrl || 'https://invalid.local', createdTime: time, updatedTime: time }).run()
    const bindingId = generateId('pme_')
    transaction.insert(providerModelEndpoints).values({ id: bindingId, providerModelId: modelId, providerEndpointId: endpointId, url: endpoint.endpointUrl || null, enabled: true, createdTime: time, updatedTime: time }).run()
    if (endpoint.protocolConversionEnabled) {
      for (const clientProtocol of CONVERTIBLE_PROTOCOLS[endpoint.protocol]) {
        transaction.insert(protocolConverters).values({ id: generateId('conv_'), providerModelEndpointId: bindingId, clientProtocol, enabled: true, createdTime: time, updatedTime: time }).run()
      }
    }
  }
}

function parseProviderModelEndpoint(row: typeof providerModelEndpoints.$inferSelect): ProviderModelEndpoint {
  return ProviderModelEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

function parseProtocolConverter(row: typeof protocolConverters.$inferSelect): ProtocolConverter {
  return ProtocolConverterSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

function mapProviderModelView(row: typeof providerModels.$inferSelect): ProviderModelView {
  const endpointRows = getDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), eq(providerEndpoints.enabled, true))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
    endpoints: endpointRows.map(({ endpoint, binding }) => ({
      ...parseProviderModelEndpoint(binding),
      protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'],
      conversions: getDb().select().from(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, binding.id)).all().map(parseProtocolConverter),
    })),
  }
}

function mapProviderModelRoute(row: typeof providerModels.$inferSelect): ProviderModelRoute {
  const endpointRows = getDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), eq(providerEndpoints.enabled, true))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    endpoints: endpointRows.map(({ endpoint, binding }) => ({
      protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'],
      endpointUrl: binding.url ?? endpoint.url,
      customAuthHeader: null,
      protocolConversionEnabled: getDb().select().from(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, binding.id)).all().some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}
