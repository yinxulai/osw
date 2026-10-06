import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { storedBody } from './stored-body'

/**
 * 数据库（`data-v1.db`）：**系统写的东西**（观测数据）。
 *
 * 请求日志、请求属性、请求级与尝试级用量、尝试、客户端与上游两侧的正文、运行时日志、
 * 供应商与供应商模型的健康状态——全部是系统在跑的过程中自己产生的，用户不可编辑。
 * 文件名的 schema 版本见 `@common/database-file`。
 *
 * 三条不变量，改动这个文件前先读完：
 *
 *   1. **不许 import `./config-schema`**，也不许反过来。两个库之间不存在外键、JOIN 与事务。
 *   2. **这个文件里的东西必须可以整个删掉。** 删掉以后应用照常启动：请求日志清空、
 *      健康状态归零（等于「所有上游都是健康的」），配置一行不少。任何「删了日志就没法启动」
 *      或「日志里存着配置的唯一副本」的设计都是错的。
 *   3. **这里的所有写操作都在请求路径上**，所以连接层给它 `synchronous = NORMAL`
 *      与 `auto_vacuum = INCREMENTAL`（见 `./index.ts`）：宁可断电丢最后几条日志，
 *      也不要让每个请求付一次 fsync。
 *
 * 关于 `provider_id` / `provider_model_id` 这两列：
 *
 * 它们指向配置库里的行，但**没有外键**——SQLite 的外键不能跨文件，而跨库写事务也不存在。
 * 代价是这里可能出现「配置里已经删掉的供应商，健康表里还留着行」，处理方式是：
 * 启动时做一次孤儿清理（`./health-store.ts` 的 `pruneOrphanHealthRows`，**唯一**一处
 * 会同时读两个库的地方），运行期出现的孤儿行由懒创建 + 覆盖写自然收敛。
 * 换来的是「删一个供应商」不需要跨库协调，也不会因为日志库损坏而删不掉配置。
 *
 * 正因为没有外键兜底，健康表的两个「成功」写入必须是 **upsert 而不是 `update`**：
 * 行不存在时 `update` 影响 0 行、不报错、静默什么都不做，而「第一次成功」恰恰是最常见的
 * 一次调用。见 `./health-store.ts`。
 */

/** 允许写入 `request_usages` / `attempt_usages` 的用量类型，避免出现无意义的透视键。 */
const USAGE_TYPE_VALUES = "'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens', 'raw'"

/** 请求的状态取值。尝试另有 {@link ATTEMPT_STATUS_VALUES}——尝试不存在 `pending`。 */
const REQUEST_STATUS_VALUES = "'pending', 'success', 'failed', 'cancelled'"

/** 尝试的状态取值。尝试行只在拿到结果后写入，「还没有结果」由没有行表达。 */
const ATTEMPT_STATUS_VALUES = "'success', 'failed', 'cancelled'"

/**
 * 供应商健康状态。**每个成功请求都会写一次这张表**，所以它属于数据库而不是配置库。
 *
 * `providerId` 无外键引用（跨库），语义上是配置库里某个供应商的 id，见文件头。
 */
export const providerHealth = sqliteTable('provider_health', {
  providerId: text('providerId').primaryKey(),
  consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
  cooldownUntilTime: integer('cooldownUntilTime'),
  lastSuccessTime: integer('lastSuccessTime'),
  lastFailureTime: integer('lastFailureTime'),
  updatedTime: integer('updatedTime').notNull(),
})

/**
 * 供应商模型健康状态。写频率与 `provider_health` 同级，理由同上。
 *
 * `providerModelId` 无外键引用（跨库）。
 */
export const providerModelHealth = sqliteTable('provider_model_health', {
  providerModelId: text('providerModelId').primaryKey(),
  consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
  cooldownUntilTime: integer('cooldownUntilTime'),
  lastSuccessTime: integer('lastSuccessTime'),
  lastFailureTime: integer('lastFailureTime'),
  updatedTime: integer('updatedTime').notNull(),
})

export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    /**
     * 客户端请求的协议。为 `null` 表示请求连 API 路径都无法识别，
     * 此时不存在「客户端协议」这个事实。
     */
    clientProtocol: text('clientProtocol'),
    /**
     * 客户端跳声明的传输形态（**预期**）。请求体里即可确定，与上游跳实际是什么形态无关
     * （后者是上游视角的事实，落在 `request_attempts.upstreamTransport`）。
     */
    transport: text('transport').notNull().default('http'),
    /**
     * 本次请求解析出的客户端 API Key。
     *
     * `null` 有两种含义，且都指「没有身份」：这次请求根本没带 Key（功能闸门关着时全部如此），
     * 或者带了但没通过校验——两种情况都不该编一个身份出来。
     *
     * 指向配置库 `api_keys`，**无外键**（跨库）。删掉一把 Key 不改写历史日志：这里留着悬空 id，
     * 与 `logicalModelId` 的处理一致。Key 本身的名字在配置库里，界面靠一次 `listApiKeys()`
     * 把 id 映回名字，历史的 Key 名因此始终是「现在」的名字，而不是写入当时的快照
     * （改名是用户能做的事，而请求日志回答的是「哪把 Key 用了多少」这件事本身）。
     */
    apiKeyId: text('apiKeyId'),
    /**
     * 本次请求解析出的逻辑模型。为 `null` 表示请求在解析出逻辑模型之前
     * 就已经失败（模型非法 / 没有启用的逻辑模型），此时该请求不会产生任何
     * 上游尝试。
     *
     * 指向配置库 `logical_models`，**无外键**（跨库）。逻辑模型在请求发起当天就被删掉时，
     * 这里允许留下悬空 id：日志是历史事实，不该因为配置改名而改写或删除。
     */
    logicalModelId: text('logicalModelId'),
    /** 本次请求从开始到收尾的总耗时：请求级唯一的数值指标，因此直接作列。 */
    totalDurationMilliseconds: integer('totalDurationMilliseconds').notNull().default(0),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    index('idx_request_logs_created_time').on(table.createdTime),
    // 状态与时间必须同处一个索引：分析页的失败原因、请求列表的状态筛选都是
    // 「状态 + 时间窗」一起给，只有单列 status 索引时 SQLite 会先扫出全部同状态行
    // 再逐行过滤时间，代价与时间窗无关（等于全表）。
    index('idx_request_logs_status_created_time').on(table.status, table.createdTime),
    index('idx_request_logs_logical_model').on(table.logicalModelId),
    index('idx_request_logs_client_protocol').on(table.clientProtocol),
    // 按 API Key 拆账（用量统计）是「一段时间内某把 Key 的全部请求」：
    // (apiKeyId, createdTime) 一次就把范围收窄到窗口内的行。
    index('idx_request_logs_api_key_time').on(table.apiKeyId, table.createdTime),
    check('chk_request_logs_status', sql`${table.status} in (${sql.raw(REQUEST_STATUS_VALUES)})`),
  ],
)

export const requestAttributes = sqliteTable(
  'request_attributes',
  {
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    key: text('key').notNull(),
    /** 属性值一律是字符串：采集侧只产出字符串，因此不另设「值类型」维度。 */
    value: text('value').notNull(),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.requestId, table.key] }),
    index('idx_request_attributes_key_value').on(table.key, table.value),
    index('idx_request_attributes_created_time').on(table.createdTime),
  ],
)

/**
 * 请求级用量：每个请求、每种用量类型恰好一行。
 *
 * 只承载「请求级」这一个视角——列名因此为裸名，不存在 `attemptId` 这类
 * 可空判别列来切换行的含义。每次尝试的用量见 {@link attemptUsages}。
 *
 * 上游返回的原始 usage 报文也写在这张表里：它同样是「这个请求的用量记录」，
 * 只是不是数值。用 `type = 'raw'` 标记、由 `rawValue` 承载内容，归属键与数值行
 * 完全一致，不需要在请求行上另开一个可空列——一份事实只存一处。
 */
export const requestUsages = sqliteTable(
  'request_usages',
  {
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    type: text('type').notNull(),
    /**
     * 数值型用量的取值。`type = 'raw'` 的行为 `null`：原始报文不是数值，
     * 用 `0` 占位会直接污染 `sum(value)`。
     */
    value: real('value'),
    /** 原始 usage 报文（JSON 文本）。只有 `type = 'raw'` 的行有值。 */
    rawValue: text('rawValue'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.requestId, table.type] }),
    // 分析页按时间窗把用量拧成列时，先用这个索引把范围收窄到窗口内的行；
    // `type` 从不作为独立过滤条件出现（都是 `type = 'x'` 的透视，用不上前导列），
    // 所以这里不再保留 (type, createdTime) 索引。
    index('idx_request_usages_created_time').on(table.createdTime),
    check('chk_request_usages_type', sql`${table.type} in (${sql.raw(USAGE_TYPE_VALUES)})`),
    check('chk_request_usages_value_shape', sql`(${table.type} = 'raw' and ${table.value} is null and ${table.rawValue} is not null) or (${table.type} <> 'raw' and ${table.value} is not null and ${table.rawValue} is null)`),
  ],
)

/**
 * 尝试级用量：每次尝试、每种用量类型恰好一行。
 *
 * 归属关系由 `request_attempts.requestId` 唯一确定，因此这里不重复保存
 * `requestId`——同一个事实只能有一个来源。
 */
export const attemptUsages = sqliteTable(
  'attempt_usages',
  {
    attemptId: text('attemptId').notNull().references(() => requestAttempts.id),
    type: text('type').notNull(),
    /** 数值型用量的取值。`type = 'raw'` 的行为 `null`。 */
    value: real('value'),
    /** 上游返回的原始 usage 报文（JSON 文本）。只有 `type = 'raw'` 的行有值。 */
    rawValue: text('rawValue'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.attemptId, table.type] }),
    // 同 `request_usages`：只按时间窗收窄，`type` 只出现在透视表达式里。
    index('idx_attempt_usages_created_time').on(table.createdTime),
    check('chk_attempt_usages_type', sql`${table.type} in (${sql.raw(USAGE_TYPE_VALUES)})`),
    check('chk_attempt_usages_value_shape', sql`(${table.type} = 'raw' and ${table.value} is null and ${table.rawValue} is not null) or (${table.type} <> 'raw' and ${table.value} is not null and ${table.rawValue} is null)`),
  ],
)

export const requestAttempts = sqliteTable(
  'request_attempts',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    /**
     * 供应商与供应商模型 id。**没有外键**（指向配置库），并且下面两列名称是
     * **写入当时的快照**：配置里改名字或删行都不影响已有日志。
     */
    providerId: text('providerId').notNull(),
    providerModelId: text('providerModelId').notNull(),
    providerName: text('providerName').notNull(),
    providerModelName: text('providerModelName').notNull(),
    /** 实际发往上游的协议。与 `request_logs.clientProtocol` 不同即代表发生过协议转换。 */
    upstreamProtocol: text('upstreamProtocol'),
    upstreamRequestId: text('upstreamRequestId'),
    url: text('url').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('httpStatus'),
    retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
    /**
     * 上游跳实际是什么形态。上游视角的事实，与客户端跳声明的形态无关；
     * 未收到响应（网络错误、请求取消）时无从判断，因此为 `null`。
     */
    upstreamTransport: text('upstreamTransport'),
    attemptIndex: integer('attemptIndex').notNull(),
    durationMilliseconds: integer('durationMilliseconds').notNull(),
    /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时为 `null`。 */
    ttftMilliseconds: integer('ttftMilliseconds'),
    errorCode: text('errorCode'),
    errorMessage: text('errorMessage'),
    /** 该次尝试在请求阶段命中的改写规则 id（JSON 数组）。 */
    requestRewriteRuleIds: text('requestRewriteRuleIds').notNull().default('[]'),
    /** 该次尝试在响应阶段命中的改写规则 id（JSON 数组）。 */
    responseRewriteRuleIds: text('responseRewriteRuleIds').notNull().default('[]'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    uniqueIndex('idx_request_attempts_request_order').on(table.requestId, table.attemptIndex),
    // 分析页的尝试级聚合全部只需要「一段时间内的尝试」，而请求时间窗的过滤条件
    // 落在 join 的另一张表上；没有这个索引时 SQLite 只能全表扫尝试，代价与时间窗无关。
    index('idx_request_attempts_created_time').on(table.createdTime),
    index('idx_request_attempts_provider_time').on(table.providerId, table.createdTime),
    index('idx_request_attempts_model_time').on(table.providerModelId, table.createdTime),
    check('chk_request_attempts_status', sql`${table.status} in (${sql.raw(ATTEMPT_STATUS_VALUES)})`),
  ],
)

/**
 * 客户端视角的正文记录：客户端原始请求 + 最终回给客户端的响应。
 * 每个请求恰好一行（`requestId` 唯一）。
 *
 * 列名不带 `client` 前缀——表本身就代表客户端视角。
 *
 * 两个正文列是 {@link storedBody}：存进去的正文一律**完整**保存，落库时压缩、
 * 读取时还原，读写两侧看到的都是原样的文本。压缩是存储细节，列名、查询与
 * 消费方都感觉不到它。
 */
export const requestContents = sqliteTable(
  'request_contents',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    captureStatus: text('captureStatus').notNull(),
    requestMethod: text('requestMethod').notNull(),
    requestPath: text('requestPath').notNull(),
    requestHeaders: text('requestHeaders'),
    requestBody: storedBody('requestBody'),
    /** 最终返回给客户端的 HTTP 状态码；为 `null` 表示客户端未收到任何响应。 */
    responseStatus: integer('responseStatus'),
    responseHeaders: text('responseHeaders'),
    responseBody: storedBody('responseBody'),

    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_request_contents_request').on(table.requestId),
    // 保留期回收按 `createdTime` 删（`pruneRequestContentsInternal`），而正文是库里
    // 唯一随请求长度线性膨胀的部分——这两张表通常远大于其余所有表之和。没有这个索引
    // 时每次回收都是全表扫描，代价随历史数据量增长，而且是一次会阻塞事件循环的
    // **同步**调用（见 issue #23）。按 `requestId` 的外键索引在这里帮不上忙：
    // 回收的入口是时间窗，不是某一批请求。
    index('idx_request_contents_created_time').on(table.createdTime),
    check('chk_request_contents_capture_status', sql`${table.captureStatus} in ('captured', 'partial')`),
  ],
)

/**
 * 上游视角的正文记录：真正发往上游的请求 + 上游返回的响应。
 * 每次尝试恰好一行（`attemptId` 唯一）。
 *
 * 列名不带 `upstream` 前缀——表本身就代表上游视角。归属的请求由
 * `request_attempts.requestId` 唯一确定，此处不重复保存。
 */
export const attemptContents = sqliteTable(
  'attempt_contents',
  {
    id: text('id').primaryKey(),
    attemptId: text('attemptId').notNull().references(() => requestAttempts.id),
    captureStatus: text('captureStatus').notNull(),
    requestHeaders: text('requestHeaders'),
    requestBody: storedBody('requestBody'),
    responseStatus: integer('responseStatus'),
    responseHeaders: text('responseHeaders'),
    responseBody: storedBody('responseBody'),

    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_attempt_contents_attempt').on(table.attemptId),
    // 同 `request_contents`：回收按 `createdTime` 删，缺索引就是全表扫描。
    index('idx_attempt_contents_created_time').on(table.createdTime),
    check('chk_attempt_contents_capture_status', sql`${table.captureStatus} in ('captured', 'partial')`),
  ],
)

export const runtimeLogs = sqliteTable(
  'runtime_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    level: text('level').notNull(),
    message: text('message').notNull(),
    timestamp: integer('timestamp').notNull(),
  },
  table => [index('idx_runtime_logs_timestamp').on(table.timestamp), index('idx_runtime_logs_level_timestamp').on(table.level, table.timestamp)],
)

export type ProviderHealthRow = typeof providerHealth.$inferSelect
export type ProviderModelHealthRow = typeof providerModelHealth.$inferSelect
export type RuntimeLogRow = typeof runtimeLogs.$inferSelect
export type RequestLogRow = typeof requestLogs.$inferSelect
export type RequestAttributeRow = typeof requestAttributes.$inferSelect
export type RequestUsageRow = typeof requestUsages.$inferSelect
export type RequestAttemptRow = typeof requestAttempts.$inferSelect
export type RequestContentRow = typeof requestContents.$inferSelect
export type AttemptContentRow = typeof attemptContents.$inferSelect
export type AttemptUsageRow = typeof attemptUsages.$inferSelect
