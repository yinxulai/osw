import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type {
  AttemptContent,
  AttemptContentSummary,
  AttemptStatus,
  Protocol,
  RawUsage,
  RequestAttempt,
  RequestAttribute,
  RequestContent,
  RequestContentCaptureStatus,
  RequestContentSummary,
  RequestLog,
  RequestLogUpdate,
  RequestStatus,
  TransportKind,
} from '@common/schemas'
import { AttemptStatusSchema, ProtocolSchema, RequestContentCaptureStatusSchema, RequestStatusSchema, TransportKindSchema } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDataDb, reclaimUnusedSpace } from './index'
import { attemptContents, attemptUsages, requestAttributes, requestAttempts, requestContents, requestLogs, requestUsages } from './data-schema'

/**
 * 新建请求日志的入参。
 *
 * 只有「请求身份 + 请求级结果」，没有任何用量字段：请求级用量的唯一写入点是
 * {@link recordAttemptUsage}（服务该请求的那次尝试落库时镜像过来）。
 */
interface CreateRequestLogInput {
  id?: string
  logicalModelId: string | null
  clientProtocol: Protocol | null
  /** 客户端跳声明的传输形态（预期）。 */
  transport: TransportKind
  status: RequestStatus
  totalDurationMilliseconds?: number
  attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
}

interface RequestLogContextUpdate {
  logicalModelId: string | null
  clientProtocol: Protocol | null
  transport: TransportKind
}

/** 用量数值。请求级与尝试级共用同一形状，只是存在不同的表里。 */
export interface UsageValues {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  reasoningTokens: number | null
  /** 上游返回的原始 usage 报文（原样保存）；未返回时为 `null`。 */
  rawUsage: RawUsage | null
}

/** 对外暴露的用量：在 {@link UsageValues} 之上补一个派生字段。 */
export interface RequestUsageValues extends UsageValues {
  /**
   * 派生值：`inputTokens + outputTokens`。
   *
   * 不落库：上游给的 `total_tokens` 有时与两个分量对不上，再存一份就会出现
   * 「总量 ≠ 明细之和」的第三个数。两个分量都拿到时才有值，否则为 `null`。
   */
  totalTokens: number | null
}

/** 用量表中以数值保存的类型。`raw` 不在其中——原始报文不是数值。 */
const USAGE_NUMERIC_TYPES = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens'] as const

/** 用量表中承载原始 usage 报文的类型标记。 */
const RAW_USAGE_TYPE = 'raw'

/**
 * 用量表的一行：类型 + 数值 / 原始报文，两者互斥（由表的 CHECK 约束保证）。
 *
 * `type` 按字符串收窄：写入侧取自上面两个字面量，读取侧由 SQLite 回传字符串，
 * 两边用同一形状才能让「写入即读出」这条闭环不用任何断言。
 */
type UsageRow = { type: string; value: number | null; rawValue: string | null }

/** 尝试级用量写入入参。归属由 `attemptId` 唯一确定。 */
export interface AttemptUsageWriteInput extends UsageValues {
  attemptId: string
  /**
   * 这次尝试是否就是「服务该请求」的那次尝试。
   *
   * 为真时同一事务里把同一组数值镜像成请求级用量：请求级用量因此没有独立写入点，
   * 不可能与尝试级数据漂移。
   */
  servesRequest: boolean
}

const EMPTY_USAGE_VALUES: UsageValues = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

/** 把用量数值摊成用量表的行：每种数值类型一行，原始报文另占一行。 */
function usageRows(values: UsageValues): UsageRow[] {
  const rows: UsageRow[] = USAGE_NUMERIC_TYPES.flatMap(type => {
    const value = values[type]
    return value == null ? [] : [{ type, value, rawValue: null }]
  })
  const rawValue = serializeRawUsage(values.rawUsage)
  if (rawValue !== null) rows.push({ type: RAW_USAGE_TYPE, value: null, rawValue })
  return rows
}

/** 把用量表的行收成用量数值。 */
function usageValues(rows: UsageRow[]): UsageValues {
  const byType = new Map(rows.map(row => [row.type, row]))
  const numeric = (type: (typeof USAGE_NUMERIC_TYPES)[number]): number | null => byType.get(type)?.value ?? null
  return {
    inputTokens: numeric('inputTokens'),
    outputTokens: numeric('outputTokens'),
    cachedInputTokens: numeric('cachedInputTokens'),
    cacheCreationInputTokens: numeric('cacheCreationInputTokens'),
    reasoningTokens: numeric('reasoningTokens'),
    rawUsage: parseRawUsage(byType.get(RAW_USAGE_TYPE)?.rawValue),
  }
}

/** `totalTokens` 是派生值：两个分量都拿到才给数。 */
function totalTokensOf(values: UsageValues): number | null {
  const { inputTokens, outputTokens } = values
  return inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens
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
  const totalDurationMilliseconds = input.totalDurationMilliseconds ?? 0
  getDataDb().insert(requestLogs).values({
    id,
    logicalModelId: input.logicalModelId,
    clientProtocol: input.clientProtocol,
    transport: input.transport,
    status: input.status,
    totalDurationMilliseconds,
    createdTime: time,
  }).run()
  if (input.attributes && input.attributes.length > 0) {
    getDataDb().insert(requestAttributes).values(input.attributes.map(attribute => ({ ...attribute, requestId: id, createdTime: time }))).run()
  }
  return {
    id,
    logicalModelId: input.logicalModelId,
    clientProtocol: input.clientProtocol,
    transport: input.transport,
    status: input.status,
    totalDurationMilliseconds,
    // 刚建立的请求还没有任何尝试，用量与 TTFT 都只能是「还不知道」。
    totalTokens: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    rawUsage: null,
    ttftMilliseconds: null,
    createdTime: time,
  }
}

export async function listRequestAttributes(requestId: string): Promise<RequestAttribute[]> {
  return getDataDb().select().from(requestAttributes).where(eq(requestAttributes.requestId, requestId)).orderBy(requestAttributes.key).all().map(row => ({ ...row, createdTime: Number(row.createdTime) }))
}

export async function replaceRequestAttributes(requestId: string, attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>): Promise<void> {
  const time = now()
  getDataDb().transaction(transaction => {
    transaction.delete(requestAttributes).where(eq(requestAttributes.requestId, requestId)).run()
    if (attributes.length > 0) transaction.insert(requestAttributes).values(attributes.map(attribute => ({ ...attribute, requestId, createdTime: time }))).run()
  })
}

/**
 * 写入一次尝试的用量。
 *
 * 归属由 `attemptId` 唯一确定。当这次尝试就是「服务该请求」的那次尝试时，
 * 同一事务里把同一组数值镜像到 `request_usages`：请求级用量因此没有独立的
 * 写入点，也就不可能出现第二份会漂移的数字。
 *
 * 请求归属不从参数传入，而是从 `request_attempts.requestId` 读——归属关系只有一处。
 */
export async function recordAttemptUsage(input: AttemptUsageWriteInput): Promise<void> {
  const time = now()
  const rows = usageRows(input)
  getDataDb().transaction(transaction => {
    transaction.delete(attemptUsages).where(eq(attemptUsages.attemptId, input.attemptId)).run()
    if (rows.length > 0) transaction.insert(attemptUsages).values(rows.map(row => ({ attemptId: input.attemptId, ...row, createdTime: time }))).run()
    if (!input.servesRequest) return
    const attempt = transaction.select({ requestId: requestAttempts.requestId }).from(requestAttempts).where(eq(requestAttempts.id, input.attemptId)).get()
    if (!attempt) return
    transaction.delete(requestUsages).where(eq(requestUsages.requestId, attempt.requestId)).run()
    if (rows.length > 0) transaction.insert(requestUsages).values(rows.map(row => ({ requestId: attempt.requestId, ...row, createdTime: time }))).run()
  })
}

export async function getRequestUsage(requestId: string): Promise<RequestUsageValues> {
  const rows = getDataDb().select({ type: requestUsages.type, value: requestUsages.value, rawValue: requestUsages.rawValue }).from(requestUsages).where(eq(requestUsages.requestId, requestId)).all()
  const values = usageValues(rows)
  return { ...values, totalTokens: totalTokensOf(values) }
}

export async function getAttemptUsage(attemptId: string): Promise<RequestUsageValues> {
  const rows = getDataDb().select({ type: attemptUsages.type, value: attemptUsages.value, rawValue: attemptUsages.rawValue }).from(attemptUsages).where(eq(attemptUsages.attemptId, attemptId)).all()
  const values = usageValues(rows)
  return { ...values, totalTokens: totalTokensOf(values) }
}

/**
 * 更新请求级结果：状态与总耗时。
 *
 * 用量不在这里写——它由 `recordAttemptUsage` 在服务该请求的那次尝试落库时写入。
 */
export async function updateRequestLogStatus(id: string, update: RequestLogUpdate): Promise<void> {
  const fields: Partial<typeof requestLogs.$inferInsert> = {}
  if (update.status !== undefined) fields.status = update.status
  if (update.totalDurationMilliseconds !== undefined) fields.totalDurationMilliseconds = update.totalDurationMilliseconds
  if (Object.keys(fields).length === 0) return
  getDataDb().update(requestLogs).set(fields).where(eq(requestLogs.id, id)).run()
}

/** 请求仍在解析或执行时补齐路由身份；状态与耗时仍只由 {@link updateRequestLogStatus} 收尾。 */
export async function updateRequestLogContext(id: string, update: RequestLogContextUpdate): Promise<void> {
  getDataDb().update(requestLogs).set({
    logicalModelId: update.logicalModelId,
    clientProtocol: update.clientProtocol,
    transport: update.transport,
  }).where(eq(requestLogs.id, id)).run()
}

export async function listRequestLogs(limit = 50, offset = 0, filter?: RequestLogFilter): Promise<RequestLog[]> {
  const conditions = requestLogFilterConditions(filter)
  const rows = getDataDb().select().from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(requestLogs.createdTime)).limit(limit).offset(offset).all()
  return mapRequestLogs(rows)
}

export async function getRequestLog(id: string): Promise<RequestLog | null> {
  const row = getDataDb().select().from(requestLogs).where(eq(requestLogs.id, id)).get()
  return row ? mapRequestLogs([row])[0] ?? null : null
}

export async function countRequestLogs(filter?: RequestLogFilter): Promise<number> {
  const conditions = requestLogFilterConditions(filter)
  return getDataDb().select({ count: sql<number>`count(*)` }).from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined).all()[0]?.count ?? 0
}

export async function pruneRequestLogs(retentionDays: number): Promise<void> {
  // 删完之后立刻回收空闲页：数据库是「一直会变大」的那个文件，
  // 删掉的行只有回收过才真正还给磁盘。
  if (pruneRequestLogsInternal(retentionDays) > 0) reclaimUnusedSpace()
}

export async function pruneRequestLogsBefore(retentionDays: number): Promise<number> {
  const deletedCount = pruneRequestLogsInternal(retentionDays)
  if (deletedCount > 0) reclaimUnusedSpace()
  return deletedCount
}

/**
 * 只清理过期的正文记录，保留请求、尝试与用量。
 *
 * 正文是日志里唯一随请求长度线性膨胀的部分。删掉它之后「这次请求用了多少 token、
 * 走了谁、快不快」全都在，只是看不到原文：历史统计与指标不会因为清理正文而失真。
 */
export async function pruneRequestContents(retentionDays: number): Promise<void> {
  if (pruneRequestContentsInternal(retentionDays) > 0) reclaimUnusedSpace()
}

export async function pruneRequestContentsBefore(retentionDays: number): Promise<number> {
  const deletedCount = pruneRequestContentsInternal(retentionDays)
  if (deletedCount > 0) reclaimUnusedSpace()
  return deletedCount
}

type CreateRequestAttemptInput = Omit<RequestAttempt, 'id' | 'createdTime' | 'errorCode' | 'errorMessage' | 'requestRewriteRuleIds' | 'responseRewriteRuleIds' | 'ttftMilliseconds'> & Partial<Pick<RequestAttempt, 'errorCode' | 'errorMessage' | 'requestRewriteRuleIds' | 'responseRewriteRuleIds' | 'ttftMilliseconds'>>

/**
 * 写入一次尝试。
 *
 * 返回 `null` 表示这次尝试已经落库——取消竞态下，「上游正常结束」与「客户端断开」
 * 两条路径会先后写同一个 `(requestId, attemptIndex)`，唯一索引会拦住后到的那次。
 * 把冲突变成显式信号而不是静默吞掉的异常：后到的路径携带的是更弱的「取消」事实，
 * 不该覆盖已经落库的结果（尤其是它的用量与正文）。
 */
export async function createRequestAttempt(input: CreateRequestAttemptInput): Promise<RequestAttempt | null> {
  const attempt: RequestAttempt = {
    ...input,
    id: generateId('att_'),
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    ttftMilliseconds: input.ttftMilliseconds ?? null,
    requestRewriteRuleIds: input.requestRewriteRuleIds ?? [],
    responseRewriteRuleIds: input.responseRewriteRuleIds ?? [],
    createdTime: now(),
  }
  const inserted = getDataDb().insert(requestAttempts).values({
    ...attempt,
    requestRewriteRuleIds: JSON.stringify(attempt.requestRewriteRuleIds),
    responseRewriteRuleIds: JSON.stringify(attempt.responseRewriteRuleIds),
  // 唯一索引 idx_request_attempts_request_order：(requestId, attemptIndex)
  }).onConflictDoNothing().returning({ id: requestAttempts.id }).all()
  return inserted.length > 0 ? attempt : null
}

type CreateRequestContentInput = Omit<RequestContent, 'id' | 'createdTime' | 'updatedTime' | 'responseStatus' | 'responseHeaders' | 'responseBody'> & Partial<Pick<RequestContent, 'responseStatus' | 'responseHeaders' | 'responseBody'>>
type UpdateRequestContentInput = Partial<Pick<RequestContent,
  | 'captureStatus'
  | 'requestMethod'
  | 'requestPath'
  | 'requestHeaders'
  | 'requestBody'
  | 'responseStatus'
  | 'responseHeaders'
  | 'responseBody'
>>

export async function createRequestContent(input: CreateRequestContentInput): Promise<RequestContent> {
  const id = generateId('content_')
  const time = now()
  const content = {
    ...input,
    responseStatus: input.responseStatus ?? null,
    responseHeaders: input.responseHeaders ?? null,
    responseBody: input.responseBody ?? null,
  }
  getDataDb().insert(requestContents).values({ id, ...content, createdTime: time, updatedTime: time }).run()
  return { id, ...content, createdTime: time, updatedTime: time }
}

export async function updateRequestContent(id: string, input: UpdateRequestContentInput): Promise<void> {
  getDataDb().update(requestContents).set({ ...input, updatedTime: now() }).where(eq(requestContents.id, id)).run()
}

export async function listRequestContents(requestId: string): Promise<RequestContent[]> {
  return getDataDb().select().from(requestContents).where(eq(requestContents.requestId, requestId)).orderBy(requestContents.createdTime).all().map(mapRequestContent)
}

// 摘要 = 整行去掉正文两列。列清单写成常量而不是 `select()` 全取再删字段：
// 解压发生在 drizzle 的 `customType.fromDriver` 里，只有**不 select** 才真的省掉
// `inflateSync`。写成全取再丢字段只是把解压白做一遍。
const requestContentSummaryColumns = {
  id: requestContents.id,
  requestId: requestContents.requestId,
  captureStatus: requestContents.captureStatus,
  requestMethod: requestContents.requestMethod,
  requestPath: requestContents.requestPath,
  requestHeaders: requestContents.requestHeaders,
  responseStatus: requestContents.responseStatus,
  responseHeaders: requestContents.responseHeaders,
  createdTime: requestContents.createdTime,
  updatedTime: requestContents.updatedTime,
}

const attemptContentSummaryColumns = {
  id: attemptContents.id,
  attemptId: attemptContents.attemptId,
  captureStatus: attemptContents.captureStatus,
  requestHeaders: attemptContents.requestHeaders,
  responseStatus: attemptContents.responseStatus,
  responseHeaders: attemptContents.responseHeaders,
  createdTime: attemptContents.createdTime,
  updatedTime: attemptContents.updatedTime,
}

/**
 * 按请求列出客户端视角正文的摘要（不含正文本身）。
 *
 * 详情接口走这条路径：详情是唯一会被界面反复重取的接口（请求还是 `pending` 时
 * 每 1.5s 一次），正文又是最大的列，因此默认不取。
 */
export async function listRequestContentSummaries(requestId: string): Promise<RequestContentSummary[]> {
  return getDataDb()
    .select(requestContentSummaryColumns)
    .from(requestContents)
    .where(eq(requestContents.requestId, requestId))
    .orderBy(requestContents.createdTime)
    .all()
    .map(row => ({ ...row, captureStatus: parseCaptureStatus(row.captureStatus) }))
}

type CreateAttemptContentInput = Omit<AttemptContent, 'id' | 'createdTime' | 'updatedTime' | 'responseStatus' | 'responseHeaders' | 'responseBody'> & Partial<Pick<AttemptContent, 'responseStatus' | 'responseHeaders' | 'responseBody'>>
type UpdateAttemptContentInput = Partial<Pick<AttemptContent, 'captureStatus' | 'responseStatus' | 'responseHeaders' | 'responseBody'>>

export async function createAttemptContent(input: CreateAttemptContentInput): Promise<AttemptContent> {
  const id = generateId('attempt_content_')
  const time = now()
  const content = {
    ...input,
    responseStatus: input.responseStatus ?? null,
    responseHeaders: input.responseHeaders ?? null,
    responseBody: input.responseBody ?? null,
  }
  getDataDb().insert(attemptContents).values({ id, ...content, createdTime: time, updatedTime: time }).run()
  return { id, ...content, createdTime: time, updatedTime: time }
}

export async function updateAttemptContent(id: string, input: UpdateAttemptContentInput): Promise<void> {
  getDataDb().update(attemptContents).set({ ...input, updatedTime: now() }).where(eq(attemptContents.id, id)).run()
}

/**
 * 按请求列出上游视角正文。
 *
 * `attempt_contents` 不保存 `requestId`，归属由 `request_attempts` 唯一
 * 持有，因此这里通过 `attemptId` 关联查询，不会出现两份归属不一致。
 */
export async function listAttemptContents(requestId: string): Promise<AttemptContent[]> {
  return getDataDb()
    .select({ content: attemptContents })
    .from(attemptContents)
    .innerJoin(requestAttempts, eq(attemptContents.attemptId, requestAttempts.id))
    .where(eq(requestAttempts.requestId, requestId))
    .orderBy(attemptContents.createdTime)
    .all()
    .map(row => mapAttemptContent(row.content))
}

/** {@link listAttemptContents} 的摘要版：同样的关联，但不取正文两列（理由见 `listRequestContentSummaries`）。 */
export async function listAttemptContentSummaries(requestId: string): Promise<AttemptContentSummary[]> {
  return getDataDb()
    .select(attemptContentSummaryColumns)
    .from(attemptContents)
    .innerJoin(requestAttempts, eq(attemptContents.attemptId, requestAttempts.id))
    .where(eq(requestAttempts.requestId, requestId))
    .orderBy(attemptContents.createdTime)
    .all()
    .map(row => ({ ...row, captureStatus: parseCaptureStatus(row.captureStatus) }))
}

export async function listAttemptsByRequest(requestId: string): Promise<RequestAttempt[]> {
  return getDataDb().select().from(requestAttempts).where(eq(requestAttempts.requestId, requestId)).orderBy(requestAttempts.attemptIndex).all().map(mapRequestAttempt)
}

/** 批量列出一批请求的尝试：列表页一行一次查询会放大成上百次往返。 */
export async function listAttemptsByRequests(requestIds: string[]): Promise<RequestAttempt[]> {
  if (requestIds.length === 0) return []
  return getDataDb().select().from(requestAttempts).where(inArray(requestAttempts.requestId, requestIds)).orderBy(requestAttempts.requestId, requestAttempts.attemptIndex).all().map(mapRequestAttempt)
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
  // 过期集合用子查询表达，而不是把 id 拉回内存再 `IN (...)` 展开：
  // 既不撞 SQLite 的绑定变量上限，也不随数据量线性膨胀。
  const staleRequests = sql`(SELECT ${requestLogs.id} FROM ${requestLogs} WHERE ${requestLogs.createdTime} < ${cutoffTime})`
  const staleAttempts = sql`(SELECT ${requestAttempts.id} FROM ${requestAttempts} WHERE ${requestAttempts.requestId} IN ${staleRequests})`
  return getDataDb().transaction(transaction => {
    const staleCount = Number(transaction.select({ count: sql<number>`count(*)` }).from(requestLogs).where(lt(requestLogs.createdTime, cutoffTime)).get()?.count ?? 0)
    if (staleCount === 0) return 0
    // 先按外键倒序删子表，再删父表。
    transaction.delete(attemptContents).where(sql`${attemptContents.attemptId} IN ${staleAttempts}`).run()
    transaction.delete(attemptUsages).where(sql`${attemptUsages.attemptId} IN ${staleAttempts}`).run()
    transaction.delete(requestContents).where(sql`${requestContents.requestId} IN ${staleRequests}`).run()
    transaction.delete(requestUsages).where(sql`${requestUsages.requestId} IN ${staleRequests}`).run()
    transaction.delete(requestAttributes).where(sql`${requestAttributes.requestId} IN ${staleRequests}`).run()
    transaction.delete(requestAttempts).where(sql`${requestAttempts.requestId} IN ${staleRequests}`).run()
    transaction.delete(requestLogs).where(sql`${requestLogs.id} IN ${staleRequests}`).run()
    return staleCount
  })
}

/**
 * 正文清理的内部实现，返回删除的正文行数（客户端视角 + 上游视角）。
 *
 * 按正文自己的 `createdTime` 判断，而不是顺着请求行找：请求行的保留窗口与正文的
 * 保留窗口是两件独立的事，正文的过期不该被请求行的存活时间牵连。
 */
function pruneRequestContentsInternal(retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return 0
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  return getDataDb().transaction(transaction => {
    const clientRows = transaction.delete(requestContents).where(lt(requestContents.createdTime, cutoffTime)).run()
    const upstreamRows = transaction.delete(attemptContents).where(lt(attemptContents.createdTime, cutoffTime)).run()
    // `changes` 的类型是 `number | bigint`（驱动差异），比较前统一收成 number。
    return Number(clientRows.changes) + Number(upstreamRows.changes)
  })
}

function serializeRawUsage(rawUsage: RawUsage | null | undefined): string | null {
  return rawUsage == null ? null : JSON.stringify(rawUsage)
}

function parseRawUsage(rawUsage: string | null | undefined): RawUsage | null {
  if (!rawUsage) return null
  try {
    const parsed = JSON.parse(rawUsage) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RawUsage : null
  } catch {
    return null
  }
}

// 读侧不使用 `as` 强转：数据库里的字符串可能来自更早的版本，先用 schema 校验，
// 失败时回退到保守值，而不是把错误类型静默带到上层。
function parseCaptureStatus(value: string): RequestContentCaptureStatus {
  const parsed = RequestContentCaptureStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : 'partial'
}

function parseRequestStatus(value: string): RequestStatus {
  const parsed = RequestStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : 'failed'
}

function parseAttemptStatus(value: string): AttemptStatus {
  const parsed = AttemptStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : 'failed'
}

function parseProtocol(value: string | null): Protocol | null {
  if (value === null) return null
  const parsed = ProtocolSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function parseTransportKind(value: string | null): TransportKind | null {
  if (value === null) return null
  const parsed = TransportKindSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * 批量把请求行映射成契约对象。
 *
 * 用量与 TTFT 都是**派生视图**，不是存储事实，而且两者口径相同——都只描述
 * 「服务该请求的那次尝试」：
 * - 用量：读的是那次尝试镜像到 `request_usages` 的行（不是多次尝试的累加）；
 * - 首字延迟：取那次尝试的 `ttftMilliseconds`。它在尝试顺序里恒为最后一次，
 *   因为故障转移一旦交付就停止。历史尝试的样本不是「客户端多久看到第一个 token」——
 *   被放弃的尝试从没向客户端写出过一个字节。
 *
 * 两个派生字段各自一批只查一次：列表页有 50 行时逐行查询会放大成上百次数据库往返。
 */
function mapRequestLogs(rows: Array<typeof requestLogs.$inferSelect>): RequestLog[] {
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)
  const usageByRequest = new Map<string, UsageValues>()
  const usageRows = getDataDb().select({ requestId: requestUsages.requestId, type: requestUsages.type, value: requestUsages.value, rawValue: requestUsages.rawValue }).from(requestUsages).where(inArray(requestUsages.requestId, ids)).all()
  for (const [requestId, group] of groupBy(usageRows, row => row.requestId)) usageByRequest.set(requestId, usageValues(group))
  // 按 attemptIndex 升序取回，因此每个请求最后写入映射的那一行就是服务该请求的尝试。
  const ttftByRequest = new Map<string, number | null>()
  const ttftRows = getDataDb()
    .select({ requestId: requestAttempts.requestId, value: requestAttempts.ttftMilliseconds })
    .from(requestAttempts)
    .where(inArray(requestAttempts.requestId, ids))
    .orderBy(requestAttempts.requestId, requestAttempts.attemptIndex)
    .all()
  for (const row of ttftRows) ttftByRequest.set(row.requestId, row.value == null ? null : Number(row.value))
  return rows.map(row => {
    const usage = usageByRequest.get(row.id) ?? EMPTY_USAGE_VALUES
    return {
      id: row.id,
      logicalModelId: row.logicalModelId,
      clientProtocol: parseProtocol(row.clientProtocol),
      transport: parseTransportKind(row.transport) ?? 'http',
      status: parseRequestStatus(row.status),
      totalDurationMilliseconds: Number(row.totalDurationMilliseconds),
      totalTokens: totalTokensOf(usage),
      inputTokens: usage.inputTokens,
      reasoningTokens: usage.reasoningTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      // 是否命中缓存是派生判断：拿到了缓存输入 token 就是命中；没拿到就不下结论。
      rawUsage: usage.rawUsage,
      ttftMilliseconds: ttftByRequest.get(row.id) ?? null,
      createdTime: Number(row.createdTime),
    }
  })
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  }
  return groups
}

function mapRequestAttempt(row: typeof requestAttempts.$inferSelect): RequestAttempt {
  return {
    id: row.id,
    requestId: row.requestId,
    providerId: row.providerId,
    providerModelId: row.providerModelId,
    providerName: row.providerName,
    providerModelName: row.providerModelName,
    upstreamProtocol: parseProtocol(row.upstreamProtocol),
    upstreamRequestId: row.upstreamRequestId,
    url: row.url,
    attemptIndex: row.attemptIndex,
    status: parseAttemptStatus(row.status),
    httpStatus: row.httpStatus,
    retryable: row.retryable,
    upstreamTransport: parseTransportKind(row.upstreamTransport),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    durationMilliseconds: row.durationMilliseconds,
    ttftMilliseconds: row.ttftMilliseconds,
    requestRewriteRuleIds: parseStringArray(row.requestRewriteRuleIds),
    responseRewriteRuleIds: parseStringArray(row.responseRewriteRuleIds),
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
    captureStatus: parseCaptureStatus(row.captureStatus),
    requestMethod: row.requestMethod,
    requestPath: row.requestPath,
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    responseStatus: row.responseStatus,
    responseHeaders: row.responseHeaders,
    responseBody: row.responseBody,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  }
}

function mapAttemptContent(row: typeof attemptContents.$inferSelect): AttemptContent {
  return {
    id: row.id,
    attemptId: row.attemptId,
    captureStatus: parseCaptureStatus(row.captureStatus),
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    responseStatus: row.responseStatus,
    responseHeaders: row.responseHeaders,
    responseBody: row.responseBody,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  }
}
