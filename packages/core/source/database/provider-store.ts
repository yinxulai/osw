import { and, asc, desc, eq, inArray, isNull, max, ne, notInArray } from 'drizzle-orm'
import { ProviderEndpointSchema, ProviderSchema, ProviderSettingSchema } from '@common/schemas'
import type { Provider, ProviderEndpoint, ProviderSetting } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { duplicateProviderEndpointError, endpointUrlInUseError, resourceNotFoundError } from '../errors'
import { getConfigDb } from './index'
import {
  providerEndpoints,
  providerModelEndpoints,
  providerModels,
  protocolConverters,
  providerSettings,
  providers,
  type ProviderEndpointRow,
} from './config-schema'

export async function listProviders(includeDeleted = false): Promise<Provider[]> {
  const db = getConfigDb()
  // 侧栏顺序由用户在界面上拖出来（`sortOrder`）；序号相同的历史行再按创建时间倒序，
  // 因此「全为 0」的老数据仍然稳定地保持原来的相对位置。
  const rows = includeDeleted
    ? db.select().from(providers).orderBy(asc(providers.sortOrder), desc(providers.createdTime)).all()
    : db.select().from(providers).where(isNull(providers.deletedTime)).orderBy(asc(providers.sortOrder), desc(providers.createdTime)).all()
  return rows.map(mapProvider)
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const row = getConfigDb().select().from(providers).where(eq(providers.id, id)).get()
  return row ? mapProvider(row) : undefined
}

type CreateProviderInput = { name: string; description?: string; apiKeyReference: string; timeoutMilliseconds?: number; enabled?: boolean }

export async function createProvider(input: CreateProviderInput): Promise<Provider> {
  const id = generateId('prov_')
  const time = now()
  const db = getConfigDb()
  const provider = ProviderSchema.parse({ ...input, description: input.description ?? '', id, createdTime: time, updatedTime: time, deletedTime: null })
  // 供应商与它的设置行必须一起落库：只写进去一半，用户看到的供应商就少了密钥引用或超时配置。
  db.transaction(transaction => {
    // 新建的供应商追加到侧栏末尾：用户拖动排序后的相对顺序不会被后续创建打乱。
    const maxSortOrder = transaction.select({ value: max(providers.sortOrder) }).from(providers).get()?.value ?? -1
    transaction.insert(providers).values({ id, name: provider.name, description: provider.description ?? '', enabled: provider.enabled, sortOrder: Number(maxSortOrder) + 1, createdTime: time, updatedTime: time }).run()
    transaction.insert(providerSettings).values([
      { providerId: id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: time },
      { providerId: id, key: 'connection.timeoutMilliseconds', value: String(provider.timeoutMilliseconds), valueType: 'number', updatedTime: time },
    ]).run()
  })
  return provider
}

export async function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Promise<Provider> {
  const db = getConfigDb()
  const time = now()
  const existing = db.select().from(providers).where(eq(providers.id, id)).get()
  if (!existing) throw resourceNotFoundError('provider', id)
  const next = ProviderSchema.parse({ ...mapProvider(existing), ...updates, id, createdTime: Number(existing.createdTime), updatedTime: time })
  // 供应商行与两条设置行是一次修改：中间失败会让保存的结果只生效一半。
  db.transaction(transaction => {
    transaction.update(providers).set({ name: next.name, description: next.description ?? '', enabled: next.enabled, updatedTime: time, deletedTime: next.deletedTime }).where(and(eq(providers.id, id), isNull(providers.deletedTime))).run()
    for (const [key, value, valueType] of [
      ['security.secretReference', next.apiKeyReference, 'string'],
      ['connection.timeoutMilliseconds', String(next.timeoutMilliseconds), 'number'],
    ] as const) {
      transaction.insert(providerSettings).values({ providerId: id, key, value, valueType, updatedTime: time }).onConflictDoUpdate({
        target: [providerSettings.providerId, providerSettings.key], set: { value, valueType, updatedTime: time },
      }).run()
    }
  })
  return next
}

/** 按传入的 id 顺序重写侧栏展示顺序；未出现在列表中的供应商保持原有顺序，不受影响。 */
export async function reorderProviders(ids: string[]): Promise<Provider[]> {
  const db = getConfigDb()
  const time = now()
  db.transaction(transaction => {
    ids.forEach((id, index) => {
      transaction.update(providers)
        .set({ sortOrder: index, updatedTime: time })
        .where(and(eq(providers.id, id), isNull(providers.deletedTime)))
        .run()
    })
  })
  return listProviders()
}

export async function listProviderSettings(providerId: string): Promise<ProviderSetting[]> {
  return getConfigDb().select().from(providerSettings).where(eq(providerSettings.providerId, providerId)).orderBy(providerSettings.key).all().map(row => ProviderSettingSchema.parse({ ...row, updatedTime: Number(row.updatedTime) }))
}

export async function getProviderSetting(providerId: string, key: string): Promise<ProviderSetting | undefined> {
  const row = getConfigDb().select().from(providerSettings).where(and(eq(providerSettings.providerId, providerId), eq(providerSettings.key, key))).get()
  return row ? ProviderSettingSchema.parse({ ...row, updatedTime: Number(row.updatedTime) }) : undefined
}

export async function upsertProviderSetting(input: Omit<ProviderSetting, 'updatedTime'>): Promise<ProviderSetting> {
  const setting = ProviderSettingSchema.parse({ ...input, updatedTime: now() })
  getConfigDb().insert(providerSettings).values(setting).onConflictDoUpdate({
    target: [providerSettings.providerId, providerSettings.key], set: { value: setting.value, valueType: setting.valueType, updatedTime: setting.updatedTime },
  }).run()
  return setting
}

export async function deleteProviderSetting(providerId: string, key: string): Promise<void> {
  getConfigDb().delete(providerSettings).where(and(eq(providerSettings.providerId, providerId), eq(providerSettings.key, key))).run()
}

export async function listProviderEndpoints(providerId: string): Promise<ProviderEndpoint[]> {
  return getConfigDb().select().from(providerEndpoints)
    .where(and(eq(providerEndpoints.providerId, providerId), isNull(providerEndpoints.deletedTime)))
    .orderBy(providerEndpoints.protocol).all().map(mapProviderEndpoint)
}

export async function getProviderEndpoint(id: string): Promise<ProviderEndpoint | undefined> {
  const row = getConfigDb().select().from(providerEndpoints).where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedTime))).get()
  return row ? mapProviderEndpoint(row) : undefined
}

function mapProviderEndpoint(row: typeof providerEndpoints.$inferSelect): ProviderEndpoint {
  return ProviderEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

type CreateProviderEndpointInput = Omit<ProviderEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'enabled' | 'deletedTime'> & { enabled?: boolean }

type Transaction = Parameters<Parameters<ReturnType<typeof getConfigDb>['transaction']>[0]>[0]

/**
 * 找出这次写入该落在哪一行上：活跃行优先，其次同（供应商，协议）的历史行，最后才是新行。
 *
 * 这是「删掉的行让出位置」这句话的落地点。**之所以要回头找历史行，而不是每次都插新行**：
 * 一条被删掉的端点下面可能还挂着端点-模型绑定与协议转换器（它们是软删除，行还在），
 * 这些行的外键指着这个端点 id。插入一条新的同协议端点会让它们永远指回那条老行——
 * 「这个协议曾经绑过谁」这句话从此断开；在同一个 id 上复活则让它们重新连上。
 *
 * 不设数据库唯一索引，因此这条「至多一条活跃行」的规则完全靠这里维持：调用方必须**先查后插**，
 * 且查与插落在同一个事务里，否则并发写入会各插一条。
 */
function findResurrectableProviderEndpoint(transaction: Transaction, providerId: string, protocol: string): ProviderEndpointRow | undefined {
  const rows = transaction.select().from(providerEndpoints)
    .where(and(eq(providerEndpoints.providerId, providerId), eq(providerEndpoints.protocol, protocol))).all()
  return rows.find(row => row.deletedTime === null) ?? rows[0]
}

export async function createProviderEndpoint(input: CreateProviderEndpointInput): Promise<ProviderEndpoint> {
  const db = getConfigDb()
  const time = now()
  const endpoint = ProviderEndpointSchema.parse({ ...input, id: generateId('end_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  let resolvedId = endpoint.id
  db.transaction(transaction => {
    const reusable = findResurrectableProviderEndpoint(transaction, endpoint.providerId, endpoint.protocol)
    // 复活就是一次 UPDATE：地址、开关重新盖上，`createdTime` 保持原样（这一行确实还是原来那一行）。
    // 记录 id 也保持原样，所以返回值必须按这一行的 id 再读一次，而不是拿刚生成的那个。
    if (reusable) {
      resolvedId = reusable.id
      transaction.update(providerEndpoints).set({ url: endpoint.url, enabled: endpoint.enabled, deletedTime: null, updatedTime: time }).where(eq(providerEndpoints.id, reusable.id)).run()
    } else {
      transaction.insert(providerEndpoints).values({ ...endpoint, deletedTime: null }).run()
    }
  })
  return await getProviderEndpoint(resolvedId) ?? { ...endpoint, id: resolvedId }
}

export async function updateProviderEndpoint(id: string, updates: Partial<Pick<ProviderEndpoint, 'protocol' | 'url' | 'enabled'>>): Promise<ProviderEndpoint> {
  const existing = await getProviderEndpoint(id)
  if (!existing) throw resourceNotFoundError('provider endpoint', id)
  const endpoint = ProviderEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  // 改协议可能撞上同供应商下的另一条活跃行。过去这是数据库约束的活（翻译成 409），
  // 现在约束没有了，重复就静静地变成两条同协议行、读取侧只会拿到其中一条——
  // 所以这里必须自己把关：命中就拒绝，并说清楚撞的是哪个协议。
  const conflict = getConfigDb().select({ id: providerEndpoints.id }).from(providerEndpoints)
    .where(and(
      eq(providerEndpoints.providerId, existing.providerId),
      eq(providerEndpoints.protocol, endpoint.protocol),
      isNull(providerEndpoints.deletedTime),
    )).all()
  if (conflict.some(row => row.id !== id)) throw duplicateProviderEndpointError(endpoint.protocol)
  getConfigDb().update(providerEndpoints).set({ protocol: endpoint.protocol, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime })
    .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedTime))).run()
  return endpoint
}

/**
 * 删除端点：一律软删除。
 *
 * 端点下面挂著「模型 ↔ 端点」绑定与协议转换器，硬删除端点会顺手把它们一起扔掉——
 * 那些行是用户在模型上配好的东西，不是缓存。所以这里统一改成打标：端点、绑定、
 * 转换器全部置 `deletedTime`（并停用），行留在表里，已部署的日志/看板仍能把它们解解出来。
 */
export async function deleteProviderEndpoint(id: string): Promise<void> {
  const time = now()
  getConfigDb().transaction(transaction => {
    const bindingRows = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints)
      .where(and(eq(providerModelEndpoints.providerEndpointId, id), isNull(providerModelEndpoints.deletedTime))).all()
    if (bindingRows.length > 0) {
      const bindingIds = bindingRows.map(binding => binding.id)
      transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(and(inArray(protocolConverters.providerModelEndpointId, bindingIds), isNull(protocolConverters.deletedTime))).run()
      transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(inArray(providerModelEndpoints.id, bindingIds)).run()
    }
    transaction.update(providerEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedTime))).run()
  })
}

export async function replaceProviderEndpoints(providerId: string, endpoints: Partial<Record<ProviderEndpoint['protocol'], string>>): Promise<ProviderEndpoint[]> {
  const states = Object.entries(endpoints)
    .filter(([, url]) => Boolean(url?.trim()))
    .map(([protocol, url]) => ({ protocol: protocol as ProviderEndpoint['protocol'], url: String(url).trim(), enabled: true }))
  return replaceProviderEndpointStates(providerId, states)
}

/**
 * 按给定状态整体替换供应商端点。
 *
 * `replaceProviderEndpoints` 只接受「启用的 protocol → url」映射，表达不了「这一行地址还在，只是被
 * 停用了」——那条行带着用户填过的 URL，是用户可见状态而不是缓存。供应商导入导出需要完整往返，
 * 所以这里额外接收 `enabled`。传入的端点集合即该供应商的端点全集：没提到的协议一律置为禁用。
 *
 * **例外是地址为空的协议载体行。** 这类行是模型绑定协议的落脚点（见 `./model-store.ts`），
 * 它不代表用户配过什么、也没有地址可以被停用，因此不在「全集」的管辖范围内：供应商配置保存时
 * 不会把它连带停用，模型那侧的绑定也不会因为一次无关的保存而消失。
 *
 * 写之前还要确认这次改动不会**连累**别的模型。端点行的 `enabled` 是协议级开关：读取侧
 * （`mapProviderModelRoute`）要求它 `= true`，所以清空或停用一个协议的默认地址，等于把该协议
 * 从所有正挂着它的模型上一起撤掉——**哪怕模型自己在绑定上写了地址也一样**。这是用户完全看不见的
 * 连带影响，所以命中时直接抛错，一个字节都不落库（见 `endpointUrlInUseError`）。
 *
 * `allowDetachingModels` 给「整体替换」场景用（供应商包导入）：那次调用连模型一起换掉了，
 * 不存在「只改了供应商、模型莫名失效」的错觉，所以不该被这道守卫挡在门外。
 */
type ReplaceProviderEndpointStatesOptions = {
  allowDetachingModels?: boolean
}

export async function replaceProviderEndpointStates(providerId: string, endpoints: Array<Pick<ProviderEndpoint, 'protocol' | 'url' | 'enabled'>>, options: ReplaceProviderEndpointStatesOptions = {}): Promise<ProviderEndpoint[]> {
  const db = getConfigDb()
  const time = now()
  db.transaction(transaction => {
    const activeRows = transaction.select().from(providerEndpoints)
      .where(and(eq(providerEndpoints.providerId, providerId), isNull(providerEndpoints.deletedTime))).all()
    const activeByProtocol = new Map(activeRows.map(row => [row.protocol, row]))

    // 保存后仍然可用的协议：地址非空**且**启用。判断口径必须与读取侧完全一致，否则守卫会在
    // 真出事的时候放行。
    const usableProtocols = new Set<string>(endpoints.filter(entry => entry.url.trim().length > 0 && entry.enabled).map(entry => entry.protocol))
    const losingAddress = activeRows.filter(row => row.enabled && row.url.trim().length > 0 && !usableProtocols.has(row.protocol))
    if (!options.allowDetachingModels && losingAddress.length > 0) {
      const affectedIds = losingAddress.map(row => row.id)
      // 只要有启用中的绑定挂在这些端点上就拦：供应商这一层一撤，绑定再有自己的地址也读不出来。
      const dependents = transaction.select({ endpointId: providerModelEndpoints.providerEndpointId, modelName: providerModels.modelName })
        .from(providerModelEndpoints)
        .innerJoin(providerModels, eq(providerModels.id, providerModelEndpoints.providerModelId))
        .where(and(
          inArray(providerModelEndpoints.providerEndpointId, affectedIds),
          eq(providerModelEndpoints.enabled, true),
          isNull(providerModelEndpoints.deletedTime),
          isNull(providerModels.deletedTime),
        )).all()
      const blockedProtocols = losingAddress
        .filter(row => dependents.some(item => item.endpointId === row.id))
        .map(row => row.protocol as ProviderEndpoint['protocol'])
      if (blockedProtocols.length > 0) {
        const providerName = transaction.select({ name: providers.name }).from(providers).where(eq(providers.id, providerId)).get()?.name ?? providerId
        throw endpointUrlInUseError(providerName, blockedProtocols, [...new Set(dependents.map(item => item.modelName))])
      }
    }

    const retainedProtocols: string[] = []
    for (const { protocol, url, enabled } of endpoints) {
      const trimmed = url.trim()
      // 空地址不进入「全集」：它表达的是「还没有默认地址」（见上面的例外说明）。
      if (!trimmed) continue
      retainedProtocols.push(protocol)
      const active = activeByProtocol.get(protocol)
      // 就地更新而不是「先删后插」：行的 id 保持不变，导出/导入和日志里的引用都不会跟着变。
      if (active) transaction.update(providerEndpoints).set({ url: trimmed, enabled, updatedTime: time }).where(eq(providerEndpoints.id, active.id)).run()
      // 没有活跃行时回头找同协议的历史行复活（而不是插新行）：绑定的协议记在供应商端点上，
      // 新建一条会让旧绑定指回那条老行，见 `findResurrectableProviderEndpoint` 的说明。
      // 模块级 `activeByProtocol` 里没有、但事务里查得到的，正是这种被删过又回来的协议。
      else {
        const reusable = findResurrectableProviderEndpoint(transaction, providerId, protocol)
        if (reusable) transaction.update(providerEndpoints).set({ url: trimmed, enabled, deletedTime: null, updatedTime: time }).where(eq(providerEndpoints.id, reusable.id)).run()
        else transaction.insert(providerEndpoints).values({ id: generateId('end_'), providerId, protocol, url: trimmed, enabled, createdTime: time, updatedTime: time, deletedTime: null }).run()
      }
    }
    transaction.update(providerEndpoints).set({ enabled: false, updatedTime: time })
      .where(and(
        eq(providerEndpoints.providerId, providerId),
        isNull(providerEndpoints.deletedTime),
        ne(providerEndpoints.url, ''),
        retainedProtocols.length === 0 ? undefined : notInArray(providerEndpoints.protocol, retainedProtocols),
      )).run()
  })
  return listProviderEndpoints(providerId)
}

export async function deleteProvider(id: string): Promise<void> {
  const time = now()
  getConfigDb().transaction(transaction => {
    transaction.update(providers).set({ deletedTime: time, updatedTime: time }).where(and(eq(providers.id, id), isNull(providers.deletedTime))).run()
    transaction.update(providerModels).set({ enabled: false, updatedTime: time, deletedTime: time }).where(and(eq(providerModels.providerId, id), isNull(providerModels.deletedTime))).run()
    // 端点、模型-端点绑定、协议转换器一并软删除：它们是供应商的子结构，
    // 只有打标才能保住「这个模型曾经绑过哪个端点/开过哪些协议转换」这份信息。
    const endpointIds = transaction.select({ id: providerEndpoints.id }).from(providerEndpoints).where(eq(providerEndpoints.providerId, id)).all().map(row => row.id)
    const modelIds = transaction.select({ id: providerModels.id }).from(providerModels).where(eq(providerModels.providerId, id)).all().map(row => row.id)
    if (modelIds.length > 0) {
      const bindingIds = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints)
        .where(inArray(providerModelEndpoints.providerModelId, modelIds)).all().map(row => row.id)
      if (bindingIds.length > 0) {
        transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
          .where(and(inArray(protocolConverters.providerModelEndpointId, bindingIds), isNull(protocolConverters.deletedTime))).run()
        transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
          .where(and(inArray(providerModelEndpoints.id, bindingIds), isNull(providerModelEndpoints.deletedTime))).run()
      }
    }
    if (endpointIds.length > 0) {
      transaction.update(providerEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(and(inArray(providerEndpoints.id, endpointIds), isNull(providerEndpoints.deletedTime))).run()
    }
  })
}

function mapProvider(row: typeof providers.$inferSelect): Provider {
  const settingRows = getConfigDb().select().from(providerSettings).where(eq(providerSettings.providerId, row.id)).all()
  const values = new Map(settingRows.map(setting => [setting.key, setting.value]))
  return {
    id: row.id, name: row.name, description: row.description, apiKeyReference: values.get('security.secretReference') ?? '',
    timeoutMilliseconds: Number(values.get('connection.timeoutMilliseconds') ?? 30000), enabled: row.enabled,
    createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime), deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}
