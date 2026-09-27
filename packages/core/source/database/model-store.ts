import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { ProtocolConverterSchema, ProviderModelEndpointSchema } from '@common/schemas'
import type {
  LogicalModelProviderModel,
  ProtocolConverter,
  ProviderModel,
  ProviderModelEndpoint,
  ProviderModelRoute,
  ProviderModelRouteEndpoint,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { endpointUrlMissingError } from '../errors'
import { getConfigDb } from './index'
import {
  providerEndpoints,
  providerModelEndpoints,
  providerModels,
  providers,
  protocolConverters,
  schedulingPolicies,
} from './config-schema'

export interface ProviderModelEndpointView extends ProviderModelEndpoint {
  protocol: ProviderModelRouteEndpoint['protocol']
  conversions: ProtocolConverter[]
}

export interface ProviderModelView extends ProviderModel {
  endpoints: ProviderModelEndpointView[]
}

export async function listProviderModels(includeDeleted = false): Promise<ProviderModelView[]> {
  const rows = getConfigDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelView)
}

export async function listProviderModelsForLogicalModel(logicalModelId: string, includeDeleted = false, includeDisabled = false): Promise<LogicalModelProviderModel[]> {
  // 这里必须分开取「绑定开关」与「模型本体开关」：两列同名（`scheduling_policies.enabled`
  // 与 `provider_models.enabled`），把策略行整行嵌进 select 时后者会被前者盖住——不是
  // node:sqlite 折叠了列名，而是早先的实现直接写了 `enabled: model.enabled`。
  // 逻辑模型页的开关写的是绑定开关，列表要读同一列，否则刷新会把已关闭的绑定弹回去；
  // 同时还要把模型本体的开关带出去，界面才能把「模型已停用」和「这个逻辑模型没启用它」
  // 分开画——前者不会被调度。
  const rows = getConfigDb().select({
    model: providerModels,
    policyEnabled: schedulingPolicies.enabled,
    policyPriority: schedulingPolicies.priority,
  })
    .from(schedulingPolicies)
    .innerJoin(providerModels, eq(schedulingPolicies.providerModelId, providerModels.id))
    .where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), isNull(schedulingPolicies.deletedTime)))
    .orderBy(asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()
  return rows
    .filter(({ model, policyEnabled }) => (includeDeleted || model.deletedTime === null) && (includeDisabled || (model.enabled && policyEnabled)))
    .map(({ model, policyEnabled, policyPriority }) => ({
      ...mapProviderModelRoute(model),
      priority: policyPriority,
      enabled: policyEnabled,
      modelEnabled: model.enabled,
    }))
}

/**
 * 批量读取多个逻辑模型的绑定。
 *
 * 返回 Map 而不是扁平数组，因为调用方已经拿着「落点顺序」；把排序重新塞回数组里只会
 * 多一层按 id 分组的逻辑。查询仍按调度策略的优先级、权重和创建时间稳定排序。
 */
export async function listProviderModelsForLogicalModels(logicalModelIds: readonly string[], includeDeleted = false, includeDisabled = false): Promise<Map<string, LogicalModelProviderModel[]>> {
  const result = new Map<string, LogicalModelProviderModel[]>()
  if (logicalModelIds.length === 0) return result

  const rows = getConfigDb().select({
    logicalModelId: schedulingPolicies.logicalModelId,
    model: providerModels,
    policyEnabled: schedulingPolicies.enabled,
    policyPriority: schedulingPolicies.priority,
  })
    .from(schedulingPolicies)
    .innerJoin(providerModels, eq(schedulingPolicies.providerModelId, providerModels.id))
    .where(and(
      inArray(schedulingPolicies.logicalModelId, [...logicalModelIds]),
      isNull(schedulingPolicies.deletedTime),
    ))
    .orderBy(asc(schedulingPolicies.logicalModelId), asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()

  for (const { logicalModelId, model, policyEnabled, policyPriority } of rows) {
    if (!includeDeleted && model.deletedTime !== null) continue
    if (!includeDisabled && (!model.enabled || !policyEnabled)) continue
    const candidates = result.get(logicalModelId) ?? []
    candidates.push({
      ...mapProviderModelRoute(model),
      priority: policyPriority,
      enabled: policyEnabled,
      modelEnabled: model.enabled,
    })
    result.set(logicalModelId, candidates)
  }
  return result
}

export async function getProviderModel(id: string): Promise<ProviderModelView | undefined> {
  const row = getConfigDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelView(row) : undefined
}

export async function listProviderModelRoutesByProvider(providerId: string, includeDeleted = false): Promise<ProviderModelRoute[]> {
  const rows = getConfigDb().select().from(providerModels)
    .where(includeDeleted ? eq(providerModels.providerId, providerId) : and(eq(providerModels.providerId, providerId), isNull(providerModels.deletedTime)))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelRoute)
}

export async function listProviderModelRoutes(includeDeleted = true): Promise<ProviderModelRoute[]> {
  const rows = getConfigDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelRoute)
}

export async function getProviderModelRoute(id: string): Promise<ProviderModelRoute | undefined> {
  const row = getConfigDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelRoute(row) : undefined
}

type CreateProviderModelRouteInput = Pick<ProviderModelRoute, 'providerId' | 'modelName' | 'priority'> & Partial<Pick<ProviderModelRoute, 'endpoints' | 'enabled'>>

export async function createProviderModelRoute(input: CreateProviderModelRouteInput): Promise<ProviderModelRoute> {
  const id = generateId('model_')
  const time = now()
  const db = getConfigDb()
  db.transaction(transaction => {
    transaction.insert(providerModels).values({ id, providerId: input.providerId, modelName: input.modelName, enabled: input.enabled ?? true, createdTime: time, updatedTime: time }).run()
    replaceRouteEndpoints(transaction, id, input.providerId, input.endpoints ?? [], time)
  })
  return { id, providerId: input.providerId, modelName: input.modelName, endpoints: input.endpoints ?? [], priority: input.priority, enabled: input.enabled ?? true, createdTime: time, updatedTime: time, deletedTime: null }
}

export async function updateProviderModelRoute(id: string, updates: Partial<Omit<ProviderModelRoute, 'id' | 'createdTime'>>): Promise<ProviderModelRoute> {
  const time = now()
  const db = getConfigDb()
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
    if (updates.enabled === false) {
      // 关闭模型时，把它在所有逻辑模型里的调度绑定一并禁用：
      // 模型已经不可用了，绑定仍「开启」会让人误以为它还会参与调度。
      transaction.update(schedulingPolicies).set({ enabled: false, updatedTime: time })
        .where(and(eq(schedulingPolicies.providerModelId, id), isNull(schedulingPolicies.deletedTime))).run()
    }
    if (updates.endpoints !== undefined) {
      // 端点集合变化交给 `replaceRouteEndpoints` 做差异更新：没变的绑定原地保留
      // （连同它的 id），只对增减做软删除/新增。
      replaceRouteEndpoints(transaction, id, updates.providerId ?? existing.providerId, updates.endpoints, time)
    }
  })
  return { ...existing, ...updates, id, updatedTime: time }
}

/**
 * 删除模型：软删除模型本身，并把挂在它下面的东西一起打标。
 *
 * 绑定、协议转换器、调度策略全部以这个模型为主语，模型软删了它们就不该再被读到
 * （逻辑模型中也不该再出现一个已删除的模型）。打标而不是删除，是为了之后仍能回答
 * 「这个模型以前绑过哪个端点」。
 */
export async function deleteProviderModelRoute(id: string): Promise<void> {
  const time = now()
  getConfigDb().transaction(transaction => {
    const bindingIds = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints)
      .where(and(eq(providerModelEndpoints.providerModelId, id), isNull(providerModelEndpoints.deletedTime))).all().map(row => row.id)
    if (bindingIds.length > 0) {
      transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(and(inArray(protocolConverters.providerModelEndpointId, bindingIds), isNull(protocolConverters.deletedTime))).run()
      transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(inArray(providerModelEndpoints.id, bindingIds)).run()
    }
    transaction.update(schedulingPolicies).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(schedulingPolicies.providerModelId, id), isNull(schedulingPolicies.deletedTime))).run()
    transaction.update(providerModels).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(providerModels.id, id), isNull(providerModels.deletedTime))).run()
  })
}

export async function listProviderModelEndpoints(providerModelId: string): Promise<ProviderModelEndpoint[]> {
  return getConfigDb().select().from(providerModelEndpoints)
    .where(and(eq(providerModelEndpoints.providerModelId, providerModelId), isNull(providerModelEndpoints.deletedTime)))
    .orderBy(providerModelEndpoints.createdTime, providerModelEndpoints.id).all().map(parseProviderModelEndpoint)
}

export async function getProviderModelEndpoint(id: string): Promise<ProviderModelEndpoint | undefined> {
  const row = getConfigDb().select().from(providerModelEndpoints).where(and(eq(providerModelEndpoints.id, id), isNull(providerModelEndpoints.deletedTime))).get()
  return row ? parseProviderModelEndpoint(row) : undefined
}

type CreateProviderModelEndpointInput = Omit<ProviderModelEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime' | 'url' | 'enabled'> & { url?: string | null; enabled?: boolean }

export async function createProviderModelEndpoint(input: CreateProviderModelEndpointInput): Promise<ProviderModelEndpoint> {
  const time = now()
  const endpoint = ProviderModelEndpointSchema.parse({ ...input, id: generateId('pme_'), url: input.url ?? null, enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getConfigDb().insert(providerModelEndpoints).values({ ...endpoint, deletedTime: null }).run()
  return endpoint
}

export async function updateProviderModelEndpoint(id: string, updates: Partial<Pick<ProviderModelEndpoint, 'providerEndpointId' | 'url' | 'enabled'>>): Promise<ProviderModelEndpoint> {
  const existing = await getProviderModelEndpoint(id)
  if (!existing) throw new Error(`provider model endpoint not found: ${id}`)
  const endpoint = ProviderModelEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getConfigDb().update(providerModelEndpoints).set({ providerEndpointId: endpoint.providerEndpointId, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime })
    .where(and(eq(providerModelEndpoints.id, id), isNull(providerModelEndpoints.deletedTime))).run()
  return endpoint
}

/** 软删除一条绑定（连同它的协议转换器）：行留下来才能回答「这个模型以前绑过什么」。 */
export async function deleteProviderModelEndpoint(id: string): Promise<void> {
  const time = now()
  getConfigDb().transaction(transaction => {
    transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(protocolConverters.providerModelEndpointId, id), isNull(protocolConverters.deletedTime))).run()
    transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(providerModelEndpoints.id, id), isNull(providerModelEndpoints.deletedTime))).run()
  })
}

export async function listProtocolConverters(providerModelEndpointId: string): Promise<ProtocolConverter[]> {
  return getConfigDb().select().from(protocolConverters)
    .where(and(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId), isNull(protocolConverters.deletedTime)))
    .orderBy(protocolConverters.createdTime, protocolConverters.id).all().map(parseProtocolConverter)
}

export async function getProtocolConverter(id: string): Promise<ProtocolConverter | undefined> {
  const row = getConfigDb().select().from(protocolConverters).where(and(eq(protocolConverters.id, id), isNull(protocolConverters.deletedTime))).get()
  return row ? parseProtocolConverter(row) : undefined
}

type CreateProtocolConverterInput = Omit<ProtocolConverter, 'id' | 'createdTime' | 'updatedTime' | 'enabled' | 'deletedTime'> & { enabled?: boolean }

export async function createProtocolConverter(input: CreateProtocolConverterInput): Promise<ProtocolConverter> {
  const time = now()
  const converter = ProtocolConverterSchema.parse({ ...input, id: generateId('conv_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getConfigDb().insert(protocolConverters).values({ ...converter, deletedTime: null }).run()
  return converter
}

export async function updateProtocolConverter(id: string, updates: Partial<Pick<ProtocolConverter, 'clientProtocol' | 'enabled'>>): Promise<ProtocolConverter> {
  const existing = await getProtocolConverter(id)
  if (!existing) throw new Error(`protocol converter not found: ${id}`)
  const converter = ProtocolConverterSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getConfigDb().update(protocolConverters).set({ clientProtocol: converter.clientProtocol, enabled: converter.enabled, updatedTime: converter.updatedTime })
    .where(and(eq(protocolConverters.id, id), isNull(protocolConverters.deletedTime))).run()
  return converter
}

export async function deleteProtocolConverter(id: string): Promise<void> {
  const time = now()
  getConfigDb().update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(eq(protocolConverters.id, id), isNull(protocolConverters.deletedTime))).run()
}

type Transaction = Parameters<Parameters<ReturnType<typeof getConfigDb>['transaction']>[0]>[0]

/**
 * 把模型的端点绑定调成给定集合。
 *
 * 「目标集合」是完整的：目标里没有的绑定一律软删除（连带它的转换器），
 * 目标里有的则原地更新——能重用就不新增，行的 id 保持稳定，
 * 因此频繁编辑模型不会每次都把全部绑定重建一遍。
 *
 * 写之前先确认每个协议都拿得到地址：模型自己没写地址、供应商那一层也没有同协议的可用地址时
 * 直接抛错，一个字节都不落库（见 `endpointUrlMissingError`）。
 */
function replaceRouteEndpoints(transaction: Transaction, modelId: string, providerId: string, endpoints: ProviderModelRouteEndpoint[], time: number): void {
  const activeBindings = transaction.select().from(providerModelEndpoints)
    .where(and(eq(providerModelEndpoints.providerModelId, modelId), isNull(providerModelEndpoints.deletedTime))).all()
  const retainedBindingIds = new Set<string>()

  // 模型自己没写地址时，地址只能来自供应商那一层，而且必须是**带地址且启用**的行：
  // `mapProviderModelRoute` 取 `binding.url ?? endpoint.url` 时要求供应商端点 `enabled = true`，
  // 两边的判断必须一致，否则这里会放过一个读回来根本没地址的模型。
  const addressedProtocols = new Set(
    transaction.select({ protocol: providerEndpoints.protocol, enabled: providerEndpoints.enabled, url: providerEndpoints.url }).from(providerEndpoints)
      .where(and(eq(providerEndpoints.providerId, providerId), isNull(providerEndpoints.deletedTime))).all()
      .filter(row => row.enabled && row.url.trim().length > 0)
      .map(row => row.protocol),
  )
  const unaddressedProtocols = endpoints
    .filter(endpoint => endpoint.endpointUrl.trim().length === 0 && !addressedProtocols.has(endpoint.protocol))
    .map(endpoint => endpoint.protocol)
  // 两层都没地址就报错，**不保存**：这时无论落空串还是落一个占位地址，存下来的都是一个
  // 打不出去的模型，而用户看不出是哪一步出的问题（见 `endpointUrlMissingError`）。
  if (unaddressedProtocols.length > 0) {
    const providerName = transaction.select({ name: providers.name }).from(providers).where(eq(providers.id, providerId)).get()?.name ?? providerId
    throw endpointUrlMissingError(providerName, unaddressedProtocols)
  }

  for (const endpoint of endpoints) {
    const endpointRow = transaction.select().from(providerEndpoints)
      .where(and(eq(providerEndpoints.providerId, providerId), eq(providerEndpoints.protocol, endpoint.protocol), isNull(providerEndpoints.deletedTime))).get()
    const endpointId = endpointRow?.id ?? generateId('end_')
    // 走到这个分支说明供应商这一层还没有这个协议的行，而它只可能是「模型自己带地址」的那种：
    // 模型没带地址的情况已经在上面被拦掉了（要么有供应商默认地址，要么直接报错）。
    //
    // 这一行是**协议载体**：绑定的协议只能记在供应商端点上（见 `docs/product/data-model.md` §3.7），
    // 所以哪怕地址全在模型自己身上也得先有这一行，它的地址恒为空串——**空串就是「还没有默认地址」**。
    // 这里绝不能编地址：编一个假地址会让用户在自己的供应商配置里看到一个没写过的「已配置」地址，
    // 请求也会真的打到那里去。也不要顺手把模型自己的地址提升成
    // 供应商默认地址：那会让一个模型的自定义值悄悄变成所有同协议绑定的默认值。模型自己的地址
    // 只记在绑定上（见下）。
    if (!endpointRow) transaction.insert(providerEndpoints).values({ id: endpointId, providerId, protocol: endpoint.protocol, url: '', enabled: true, createdTime: time, updatedTime: time, deletedTime: null }).run()

    const binding = activeBindings.find(item => item.providerEndpointId === endpointId)
    const bindingId = binding?.id ?? generateId('pme_')
    if (binding) transaction.update(providerModelEndpoints).set({ url: endpoint.endpointUrl || null, enabled: true, updatedTime: time }).where(eq(providerModelEndpoints.id, bindingId)).run()
    else transaction.insert(providerModelEndpoints).values({ id: bindingId, providerModelId: modelId, providerEndpointId: endpointId, url: endpoint.endpointUrl || null, enabled: true, createdTime: time, updatedTime: time, deletedTime: null }).run()
    retainedBindingIds.add(bindingId)

    syncProtocolConverters(transaction, bindingId, endpoint.protocol, endpoint.protocolConversionEnabled, time)
  }

  const removedBindings = activeBindings.filter(binding => !retainedBindingIds.has(binding.id))
  if (removedBindings.length === 0) return
  const removedBindingIds = removedBindings.map(binding => binding.id)
  transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(inArray(protocolConverters.providerModelEndpointId, removedBindingIds), isNull(protocolConverters.deletedTime))).run()
  transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(inArray(providerModelEndpoints.id, removedBindingIds)).run()
}

/**
 * 把一条绑定的协议转换器调成给定状态。
 *
 * 开启转换时目标集合是 `CONVERTIBLE_PROTOCOLS[protocol]`，关闭时是空集。
 * 同 `replaceRouteEndpoints`：能重用就原地启用，多出来的软删除。
 */
function syncProtocolConverters(transaction: Transaction, providerModelEndpointId: string, protocol: ProviderModelRouteEndpoint['protocol'], enabled: boolean, time: number): void {
  const desiredProtocols = enabled ? CONVERTIBLE_PROTOCOLS[protocol] : []
  const activeConverters = transaction.select().from(protocolConverters)
    .where(and(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId), isNull(protocolConverters.deletedTime))).all()
  const activeByProtocol = new Map(activeConverters.map(converter => [converter.clientProtocol, converter]))
  const retainedProtocols: string[] = []

  for (const clientProtocol of desiredProtocols) {
    retainedProtocols.push(clientProtocol)
    const active = activeByProtocol.get(clientProtocol)
    if (active) {
      if (!active.enabled) transaction.update(protocolConverters).set({ enabled: true, updatedTime: time }).where(eq(protocolConverters.id, active.id)).run()
      continue
    }
    transaction.insert(protocolConverters).values({ id: generateId('conv_'), providerModelEndpointId, clientProtocol, enabled: true, createdTime: time, updatedTime: time, deletedTime: null }).run()
  }

  transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(
      eq(protocolConverters.providerModelEndpointId, providerModelEndpointId),
      isNull(protocolConverters.deletedTime),
      retainedProtocols.length === 0 ? undefined : notInArray(protocolConverters.clientProtocol, retainedProtocols),
    )).run()
}

function parseProviderModelEndpoint(row: typeof providerModelEndpoints.$inferSelect): ProviderModelEndpoint {
  return ProviderModelEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

function parseProtocolConverter(row: typeof protocolConverters.$inferSelect): ProtocolConverter {
  return ProtocolConverterSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

function mapProviderModelView(row: typeof providerModels.$inferSelect): ProviderModelView {
  const endpointRows = getConfigDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), isNull(providerModelEndpoints.deletedTime), eq(providerEndpoints.enabled, true), isNull(providerEndpoints.deletedTime))).all()
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
      conversions: getConfigDb().select().from(protocolConverters).where(and(eq(protocolConverters.providerModelEndpointId, binding.id), isNull(protocolConverters.deletedTime))).all().map(parseProtocolConverter),
    })),
  }
}

function mapProviderModelRoute(row: typeof providerModels.$inferSelect): ProviderModelRoute {
  const endpointRows = getConfigDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), isNull(providerModelEndpoints.deletedTime), eq(providerEndpoints.enabled, true), isNull(providerEndpoints.deletedTime))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    endpoints: endpointRows.map(({ endpoint, binding }) => ({
      protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'],
      endpointUrl: binding.url ?? endpoint.url,
      customAuthHeader: null,
      protocolConversionEnabled: getConfigDb().select().from(protocolConverters).where(and(eq(protocolConverters.providerModelEndpointId, binding.id), isNull(protocolConverters.deletedTime))).all().some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}
