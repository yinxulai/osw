import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type {
  RawUsage,
  RequestAttempt,
  RequestAttribute,
  RequestAttributeValueType,
  RequestContent,
  RequestContentCaptureStatus,
  RequestConversion,
  RequestLog,
  RequestLogEntry,
  RequestLogUpdate,
  RequestStatus,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import { requestAttributes, requestAttempts, requestContents, requestConversions, requestLogs, requestMetrics, requestUsages } from './schema'

type CreateRequestLogInput = Omit<RequestLog, 'id' | 'createdTime' | 'reasoningTokens'> & { id?: string; reasoningTokens?: number | null; attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>> }

export interface RequestUsageSnapshot {
  requestId: string
  attemptId: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  reasoningTokens?: number | null
  rawUsage: RawUsage | null
}

export interface RequestLogFilter {
  providerId?: string
  providerModelId?: string
  logicalModelId?: string
  clientProtocol?: string
  status?: RequestStatus
  createdTimeFrom?: number
  createdTimeTo?: number
}

export async function createRequestLog(input: CreateRequestLogInput): Promise<RequestLog> {
  const id = input.id ?? generateId('req_')
  const time = now()
  getDb().insert(requestLogs).values({ id, logicalModelId: input.logicalModelId, clientProtocol: input.clientProtocol, upstreamProtocol: input.upstreamProtocol ?? null, status: input.status, metadata: null, createdTime: time }).run()
  const metricValues: Array<typeof requestMetrics.$inferInsert> = []
  if (input.totalDurationMilliseconds != null) metricValues.push({ requestId: id, key: 'durationMilliseconds', value: input.totalDurationMilliseconds, unit: 'milliseconds', updatedTime: time })
  if (input.ttftMilliseconds != null) metricValues.push({ requestId: id, key: 'ttftMilliseconds', value: input.ttftMilliseconds, unit: 'milliseconds', updatedTime: time })
  if (input.promptCacheHit != null) metricValues.push({ requestId: id, key: 'promptCacheHit', value: input.promptCacheHit ? 1 : 0, unit: 'boolean', updatedTime: time })
  if (input.cacheHit != null) metricValues.push({ requestId: id, key: 'cacheHit', value: input.cacheHit ? 1 : 0, unit: 'boolean', updatedTime: time })
  if (metricValues.length > 0) getDb().insert(requestMetrics).values(metricValues).run()
  if (input.attributes && input.attributes.length > 0) {
    getDb().insert(requestAttributes).values(input.attributes.map(attribute => ({ ...attribute, requestId: id, createdTime: time }))).run()
  }
  await replaceRequestUsage({
    requestId: id,
    attemptId: null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    reasoningTokens: input.reasoningTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
    rawUsage: input.rawUsage ?? null,
  })
  return {
    id,
    logicalModelId: input.logicalModelId,
    clientProtocol: input.clientProtocol,
    upstreamProtocol: input.upstreamProtocol ?? null,
    status: input.status,
    totalDurationMilliseconds: input.totalDurationMilliseconds,
    totalTokens: input.totalTokens ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    reasoningTokens: input.reasoningTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
    promptCacheHit: input.promptCacheHit ?? null,
    rawUsage: input.rawUsage ?? null,
    ttftMilliseconds: input.ttftMilliseconds ?? null,
    cacheHit: input.cacheHit ?? null,
    createdTime: time,
  }
}

export async function listRequestAttributes(requestId: string): Promise<RequestAttribute[]> {
  return getDb().select().from(requestAttributes).where(eq(requestAttributes.requestId, requestId)).orderBy(requestAttributes.key).all().map(row => ({ ...row, valueType: row.valueType as RequestAttributeValueType, createdTime: Number(row.createdTime) }))
}

export async function replaceRequestAttributes(requestId: string, attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    transaction.delete(requestAttributes).where(eq(requestAttributes.requestId, requestId)).run()
    if (attributes.length > 0) transaction.insert(requestAttributes).values(attributes.map(attribute => ({ ...attribute, requestId, createdTime: time }))).run()
  })
}

export async function replaceRequestUsage(input: RequestUsageSnapshot): Promise<void> {
  const time = now()
  const scope = input.attemptId === null
    ? and(eq(requestUsages.requestId, input.requestId), isNull(requestUsages.attemptId))
    : and(eq(requestUsages.requestId, input.requestId), eq(requestUsages.attemptId, input.attemptId))
  const values: Array<{ type: string; value: number; unit: string; rawValue?: string | null }> = []
  const tokenValues: Array<readonly [string, number | null]> = [
    ['inputTokens', input.inputTokens],
    ['outputTokens', input.outputTokens],
    ['reasoningTokens', input.reasoningTokens ?? null],
    ['totalTokens', input.totalTokens],
    ['cachedInputTokens', input.cachedInputTokens],
    ['cacheCreationInputTokens', input.cacheCreationInputTokens],
  ]
  for (const [type, value] of tokenValues) {
    if (value != null) values.push({ type, value, unit: 'tokens' })
  }
  if (input.rawUsage !== null) values.push({ type: 'raw', value: 0, unit: 'string', rawValue: serializeRawUsage(input.rawUsage) })
  getDb().transaction(transaction => {
    transaction.delete(requestUsages).where(scope).run()
    if (values.length > 0) transaction.insert(requestUsages).values(values.map(value => ({ id: generateId('usage_'), requestId: input.requestId, attemptId: input.attemptId, ...value, createdTime: time }))).run()
  })
}

export async function listRequestUsages(requestId: string): Promise<RequestUsageSnapshot[]> {
  const rows = getDb().select().from(requestUsages).where(eq(requestUsages.requestId, requestId)).all()
  const scopes = new Map<string, typeof rows>()
  for (const row of rows) scopes.set(row.attemptId ?? 'request', [...(scopes.get(row.attemptId ?? 'request') ?? []), row])
  return [...scopes.entries()].map(([key, usages]) => {
    const value = (type: string) => usages.find(usage => usage.type === type)?.value ?? null
    return {
      requestId,
      attemptId: key === 'request' ? null : key,
      inputTokens: value('inputTokens'),
      outputTokens: value('outputTokens'),
      reasoningTokens: value('reasoningTokens'),
      totalTokens: value('totalTokens'),
      cachedInputTokens: value('cachedInputTokens'),
      cacheCreationInputTokens: value('cacheCreationInputTokens'),
      rawUsage: parseRawUsage(usages.find(usage => usage.type === 'raw')?.rawValue),
    }
  })
}

export async function updateRequestLogStatus(id: string, update: RequestLogUpdate): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    const logUpdates: Partial<typeof requestLogs.$inferInsert> = {}
    if (update.status !== undefined) logUpdates.status = update.status
    if (update.upstreamProtocol !== undefined) logUpdates.upstreamProtocol = update.upstreamProtocol
    if (Object.keys(logUpdates).length > 0) transaction.update(requestLogs).set(logUpdates).where(eq(requestLogs.id, id)).run()
    const metrics: Array<{ key: string; value: number; unit: string }> = []
    if (update.totalDurationMilliseconds !== undefined) metrics.push({ key: 'durationMilliseconds', value: update.totalDurationMilliseconds, unit: 'milliseconds' })
    for (const [field, key, unit] of [['ttftMilliseconds', 'ttftMilliseconds', 'milliseconds']] as const) {
      const value = update[field]
      if (value === null) transaction.delete(requestMetrics).where(and(eq(requestMetrics.requestId, id), eq(requestMetrics.key, key))).run()
      else if (value !== undefined) metrics.push({ key, value, unit })
    }
    for (const [field, key] of [['promptCacheHit', 'promptCacheHit'], ['cacheHit', 'cacheHit']] as const) {
      const value = update[field]
      if (value === null) transaction.delete(requestMetrics).where(and(eq(requestMetrics.requestId, id), eq(requestMetrics.key, key))).run()
      else if (value !== undefined) metrics.push({ key, value: value ? 1 : 0, unit: 'boolean' })
    }
    for (const metric of metrics) transaction.insert(requestMetrics).values({ requestId: id, ...metric, updatedTime: time }).onConflictDoUpdate({ target: [requestMetrics.requestId, requestMetrics.key], set: { value: metric.value, unit: metric.unit, updatedTime: time } }).run()
    const requestScope = and(eq(requestUsages.requestId, id), isNull(requestUsages.attemptId))
    for (const [field, type] of [['inputTokens', 'inputTokens'], ['outputTokens', 'outputTokens'], ['totalTokens', 'totalTokens'], ['cachedInputTokens', 'cachedInputTokens'], ['cacheCreationInputTokens', 'cacheCreationInputTokens'], ['reasoningTokens', 'reasoningTokens']] as const) {
      const value = update[field]
      if (value === null) transaction.delete(requestUsages).where(and(requestScope, eq(requestUsages.type, type))).run()
      else if (value !== undefined) {
        transaction.delete(requestUsages).where(and(requestScope, eq(requestUsages.type, type))).run()
        transaction.insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type, value, unit: 'tokens', createdTime: time }).run()
      }
    }
    if (update.rawUsage !== undefined) {
      transaction.delete(requestUsages).where(and(requestScope, eq(requestUsages.type, 'raw'))).run()
      if (update.rawUsage !== null) transaction.insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type: 'raw', value: 0, unit: 'string', rawValue: serializeRawUsage(update.rawUsage), createdTime: time }).run()
    }
  })
}

export async function listRequestLogs(limit = 50, offset = 0, filter?: RequestLogFilter): Promise<RequestLog[]> {
  const conditions = requestLogFilterConditions(filter)
  return getDb().select().from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(requestLogs.createdTime)).limit(limit).offset(offset).all().map(mapRequestLog)
}

export async function listRequestLogEntries(limit = 50, offset = 0, filter?: RequestLogFilter): Promise<RequestLogEntry[]> {
  const conditions = requestLogFilterConditions(filter)
  const rows = getDb().select().from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(requestLogs.createdTime)).limit(limit).offset(offset).all()
  if (rows.length === 0) return []

  const ids = rows.map(row => row.id)
  const attempts = getDb().select().from(requestAttempts).where(inArray(requestAttempts.requestId, ids)).all().map(mapRequestAttempt)
  const metrics = getDb().select().from(requestMetrics).where(inArray(requestMetrics.requestId, ids)).all()
  const usages = getDb().select().from(requestUsages).where(inArray(requestUsages.requestId, ids)).all()
  const attemptsByRequest = new Map<string, RequestAttempt[]>()
  for (const attempt of attempts) attemptsByRequest.set(attempt.requestId, [...(attemptsByRequest.get(attempt.requestId) ?? []), attempt])
  const metricsByRequest = new Map<string, typeof metrics>()
  for (const metric of metrics) metricsByRequest.set(metric.requestId, [...(metricsByRequest.get(metric.requestId) ?? []), metric])
  const usagesByRequest = new Map<string, typeof usages>()
  for (const usage of usages) usagesByRequest.set(usage.requestId, [...(usagesByRequest.get(usage.requestId) ?? []), usage])

  return rows.map(row => {
    const log = mapRequestLogWithData(row, metricsByRequest.get(row.id) ?? [], usagesByRequest.get(row.id) ?? [])
    return {
      ...log,
      reasoningTokens: log.reasoningTokens ?? null,
      attempts: (attemptsByRequest.get(row.id) ?? []).map(attempt => ({
        id: attempt.id,
        attemptIndex: attempt.attemptIndex,
        status: attempt.status,
        providerId: attempt.providerId,
        providerName: attempt.providerName,
        providerModelId: attempt.providerModelId,
        providerModelName: attempt.providerModelName,
        upstreamProtocol: attempt.upstreamProtocol,
        upstreamRequestId: attempt.upstreamRequestId,
        url: attempt.url,
        httpStatus: attempt.httpStatus,
        retryable: attempt.retryable,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        durationMilliseconds: attempt.durationMilliseconds,
        createdTime: attempt.createdTime,
      })),
    }
  })
}

export async function getRequestLog(id: string): Promise<RequestLog | null> {
  const row = getDb().select().from(requestLogs).where(eq(requestLogs.id, id)).get()
  return row ? mapRequestLog(row) : null
}

export async function countRequestLogs(filter?: RequestLogFilter): Promise<number> {
  const conditions = requestLogFilterConditions(filter)
  return getDb().select({ count: sql<number>`count(*)` }).from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined).all()[0]?.count ?? 0
}

export async function pruneRequestLogs(retentionDays: number): Promise<void> {
  await pruneRequestLogsInternal(retentionDays)
}

export async function pruneRequestLogsBefore(retentionDays: number): Promise<number> {
  return pruneRequestLogsInternal(retentionDays)
}

type CreateRequestAttemptInput = Omit<RequestAttempt, 'id' | 'createdTime' | 'errorCode' | 'errorMessage'> & Partial<Pick<RequestAttempt, 'errorCode' | 'errorMessage'>>

export async function createRequestAttempt(input: CreateRequestAttemptInput): Promise<RequestAttempt> {
  const id = generateId('att_')
  const time = now()
  const attempt = { id, ...input, errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null, createdTime: time }
  getDb().insert(requestAttempts).values(attempt).run()
  return attempt
}

type CreateRequestContentInput = Omit<RequestContent, 'id' | 'createdTime' | 'updatedTime' | 'requestRewriteRuleIds'> & Partial<Pick<RequestContent, 'requestRewriteRuleIds'>>
type UpdateRequestContentInput = Partial<Pick<RequestContent, 'captureStatus' | 'responseStatus' | 'responseHeaders' | 'responseBody'>>

export async function createRequestContent(input: CreateRequestContentInput): Promise<RequestContent> {
  const id = generateId('content_')
  const time = now()
  getDb().insert(requestContents).values({ id, ...input, requestRewriteRuleIds: JSON.stringify(input.requestRewriteRuleIds ?? []), createdTime: time, updatedTime: time }).run()
  return { id, ...input, requestRewriteRuleIds: input.requestRewriteRuleIds ?? [], createdTime: time, updatedTime: time }
}

export async function updateRequestContent(id: string, input: UpdateRequestContentInput): Promise<void> {
  getDb().update(requestContents).set({ ...input, updatedTime: now() }).where(eq(requestContents.id, id)).run()
}

export async function listRequestContents(requestId: string): Promise<RequestContent[]> {
  return getDb().select().from(requestContents).where(eq(requestContents.requestId, requestId)).orderBy(requestContents.createdTime).all().map(mapRequestContent)
}

export type CreateRequestConversionInput = Omit<RequestConversion, 'id' | 'createdTime'>

export async function createRequestConversion(input: CreateRequestConversionInput): Promise<RequestConversion> {
  const conversion = { id: generateId('conversion_'), ...input, createdTime: now() }
  getDb().insert(requestConversions).values(conversion).run()
  return conversion
}

export async function listRequestConversions(requestId: string): Promise<RequestConversion[]> {
  return getDb().select().from(requestConversions).where(eq(requestConversions.requestId, requestId)).orderBy(requestConversions.createdTime).all().map(mapRequestConversion)
}

export async function listAttemptsByRequest(requestId: string): Promise<RequestAttempt[]> {
  return getDb().select().from(requestAttempts).where(eq(requestAttempts.requestId, requestId)).orderBy(requestAttempts.attemptIndex).all().map(mapRequestAttempt)
}

function requestLogFilterConditions(filter?: RequestLogFilter) {
  if (!filter) return []
  const conditions = []
  if (filter.providerId) conditions.push(sql`EXISTS (SELECT 1 FROM ${requestAttempts} a WHERE a.requestId = ${requestLogs.id} AND a.providerId = ${filter.providerId})`)
  if (filter.providerModelId) conditions.push(sql`EXISTS (SELECT 1 FROM ${requestAttempts} a WHERE a.requestId = ${requestLogs.id} AND a.providerModelId = ${filter.providerModelId})`)
  if (filter.logicalModelId) conditions.push(eq(requestLogs.logicalModelId, filter.logicalModelId))
  if (filter.clientProtocol) conditions.push(eq(requestLogs.clientProtocol, filter.clientProtocol))
  if (filter.status) conditions.push(eq(requestLogs.status, filter.status))
  if (filter.createdTimeFrom !== undefined) conditions.push(gte(requestLogs.createdTime, filter.createdTimeFrom))
  if (filter.createdTimeTo !== undefined) conditions.push(lt(requestLogs.createdTime, filter.createdTimeTo))
  return conditions
}

function pruneRequestLogsInternal(retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return 0
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  return getDb().transaction(transaction => {
    const staleIds = transaction.select({ id: requestLogs.id }).from(requestLogs).where(lt(requestLogs.createdTime, cutoffTime)).all().map(row => row.id)
    if (staleIds.length === 0) return 0
    transaction.delete(requestContents).where(inArray(requestContents.requestId, staleIds)).run()
    transaction.delete(requestUsages).where(inArray(requestUsages.requestId, staleIds)).run()
    transaction.delete(requestMetrics).where(inArray(requestMetrics.requestId, staleIds)).run()
    transaction.delete(requestAttributes).where(inArray(requestAttributes.requestId, staleIds)).run()
    transaction.delete(requestConversions).where(inArray(requestConversions.requestId, staleIds)).run()
    transaction.delete(requestAttempts).where(inArray(requestAttempts.requestId, staleIds)).run()
    transaction.delete(requestLogs).where(inArray(requestLogs.id, staleIds)).run()
    return staleIds.length
  })
}

function serializeRawUsage(rawUsage: RequestLog['rawUsage'] | undefined): string | null {
  return rawUsage == null ? null : JSON.stringify(rawUsage)
}

function parseRawUsage(rawUsage: string | null | undefined): RequestLog['rawUsage'] {
  if (!rawUsage) return null
  try {
    const parsed = JSON.parse(rawUsage)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RequestLog['rawUsage'] : null
  } catch {
    return null
  }
}

function mapRequestLog(row: typeof requestLogs.$inferSelect): RequestLog {
  const metrics = getDb().select().from(requestMetrics).where(eq(requestMetrics.requestId, row.id)).all()
  const usages = getDb().select().from(requestUsages).where(and(eq(requestUsages.requestId, row.id), isNull(requestUsages.attemptId))).all()
  return mapRequestLogWithData(row, metrics, usages)
}

function mapRequestLogWithData(row: typeof requestLogs.$inferSelect, metricRows: Array<typeof requestMetrics.$inferSelect>, usageRows: Array<typeof requestUsages.$inferSelect>): RequestLog {
  const metrics = new Map(metricRows.map(metric => [metric.key, metric]))
  const usageValue = (type: string) => usageRows.find(usage => usage.type === type)?.value ?? null
  const metricValue = (key: string) => metrics.get(key)?.value ?? null
  return {
    id: row.id,
    logicalModelId: row.logicalModelId,
    clientProtocol: row.clientProtocol as RequestLog['clientProtocol'],
    upstreamProtocol: row.upstreamProtocol as RequestLog['upstreamProtocol'],
    status: row.status as RequestStatus,
    totalDurationMilliseconds: Number(metricValue('durationMilliseconds') ?? 0),
    totalTokens: usageValue('totalTokens'),
    inputTokens: usageValue('inputTokens'),
    reasoningTokens: usageValue('reasoningTokens'),
    outputTokens: usageValue('outputTokens'),
    cachedInputTokens: usageValue('cachedInputTokens'),
    cacheCreationInputTokens: usageValue('cacheCreationInputTokens'),
    promptCacheHit: metricValue('promptCacheHit') == null ? null : metricValue('promptCacheHit') === 1,
    rawUsage: parseRawUsage(usageRows.find(usage => usage.type === 'raw')?.rawValue),
    ttftMilliseconds: metricValue('ttftMilliseconds'),
    cacheHit: metricValue('cacheHit') == null ? null : metricValue('cacheHit') === 1,
    createdTime: Number(row.createdTime),
  }
}

function mapRequestAttempt(row: typeof requestAttempts.$inferSelect): RequestAttempt {
  return {
    id: row.id,
    requestId: row.requestId,
    providerId: row.providerId,
    providerModelId: row.providerModelId,
    providerName: row.providerName,
    providerModelName: row.providerModelName,
    upstreamProtocol: row.upstreamProtocol as RequestAttempt['upstreamProtocol'],
    upstreamRequestId: row.upstreamRequestId,
    url: row.url,
    attemptIndex: row.attemptIndex,
    status: row.status as RequestStatus,
    httpStatus: row.httpStatus,
    retryable: row.retryable,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    durationMilliseconds: row.durationMilliseconds,
    createdTime: Number(row.createdTime),
  }
}

function mapRequestConversion(row: typeof requestConversions.$inferSelect): RequestConversion {
  return {
    id: row.id,
    requestId: row.requestId,
    attemptId: row.attemptId,
    clientProtocol: row.clientProtocol as RequestConversion['clientProtocol'],
    upstreamProtocol: row.upstreamProtocol as RequestConversion['upstreamProtocol'],
    clientRequestHeaders: row.clientRequestHeaders,
    upstreamRequestHeaders: row.upstreamRequestHeaders,
    upstreamResponseHeaders: row.upstreamResponseHeaders,
    clientResponseHeaders: row.clientResponseHeaders,
    requestBody: row.requestBody,
    responseBody: row.responseBody,
    streaming: row.streaming,
    durationMilliseconds: row.durationMilliseconds,
    createdTime: Number(row.createdTime),
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

function mapRequestContent(row: typeof requestContents.$inferSelect): RequestContent {
  return {
    id: row.id,
    requestId: row.requestId,
    attemptId: row.attemptId,
    captureStatus: row.captureStatus as RequestContentCaptureStatus,
    requestMethod: row.requestMethod,
    requestPath: row.requestPath,
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    responseStatus: row.responseStatus,
    responseHeaders: row.responseHeaders,
    responseBody: row.responseBody,
    requestRewriteRuleIds: row.requestRewriteRuleIds ? parseStringArray(row.requestRewriteRuleIds) : [],
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  }
}
