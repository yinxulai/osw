import {
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

/**
 * 供应商表：id + JSON data。新增供应商字段只需更新 ProviderSchema，无需变更表结构。
 */
export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    /** JSON 序列化的 ProviderSchema 字段（除 id 外） */
    data: text('data').notNull(),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [index('idx_providers_deleted_time').on(table.deletedTime)],
)

export const logicalModels = sqliteTable(
  'logical_models',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_logical_models_name').on(table.name),
    index('idx_logical_models_deleted_time').on(table.deletedTime),
  ],
)

export const upstreamModels = sqliteTable(
  'upstream_models',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId')
      .notNull()
      .references(() => providers.id),
    upstreamModelId: text('upstreamModelId').notNull(),
    /** JSON 序列化的协议端点列表，一个模型可支持多个协议 */
    endpoints: text('endpoints').notNull().default('[]'),
    priority: integer('priority').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_upstream_models_priority').on(table.priority),
    index('idx_upstream_models_provider').on(table.providerId),
    index('idx_upstream_models_deleted_time').on(table.deletedTime),
  ],
)

export const providerHealth = sqliteTable(
  'provider_health',
  {
    providerId: text('providerId')
      .primaryKey()
      .references(() => providers.id),
    consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
    cooldownUntilTime: integer('cooldownUntilTime'),
    lastSuccessTime: integer('lastSuccessTime'),
    lastFailureTime: integer('lastFailureTime'),
    updatedTime: integer('updatedTime').notNull(),
  },
)

/**
 * 通用 key-value 设置表：每个设置项一行，value 存 JSON。
 * 新增设置项只需更新 SettingsSchema 默认值，无需变更表结构。
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: text('id').primaryKey(),
    logicalModelId: text('logicalModelId').notNull(),
    protocol: text('protocol').notNull(),
    /** 实际请求上游时使用的协议；与 protocol 不同表示经过了协议转换 */
    upstreamProtocol: text('upstreamProtocol'),
    status: text('status').notNull(),
    totalDurationMilliseconds: integer('totalDurationMilliseconds').notNull(),
    totalTokens: integer('totalTokens'),
    inputTokens: integer('inputTokens'),
    outputTokens: integer('outputTokens'),
    cachedInputTokens: integer('cachedInputTokens'),
    cacheCreationInputTokens: integer('cacheCreationInputTokens'),
    promptCacheHit: integer('promptCacheHit', { mode: 'boolean' }),
    rawUsage: text('rawUsage'),
    ttftMilliseconds: integer('ttftMilliseconds'),
    cacheHit: integer('cacheHit', { mode: 'boolean' }),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    index('idx_request_logs_created_time').on(table.createdTime),
    index('idx_request_logs_status').on(table.status),
  ],
)

export const requestAttempts = sqliteTable(
  'request_attempts',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId')
      .notNull()
      .references(() => requestLogs.id),
    providerId: text('providerId')
      .notNull()
      .references(() => providers.id),
    upstreamModelId: text('upstreamModelId').notNull(),
    attemptIndex: integer('attemptIndex').notNull(),
    status: text('status').notNull(),
    errorCode: text('errorCode'),
    errorMessage: text('errorMessage'),
    upstreamRequestId: text('upstreamRequestId'),
    errorResponse: text('errorResponse'),
    durationMilliseconds: integer('durationMilliseconds').notNull(),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    index('idx_attempts_request_id').on(table.requestId),
    index('idx_attempts_request_order').on(table.requestId, table.attemptIndex),
    index('idx_attempts_provider').on(table.providerId),
    index('idx_attempts_created_time').on(table.createdTime),
  ],
)

export const requestContents = sqliteTable(
  'request_contents',
  {
    requestId: text('requestId')
      .primaryKey()
      .references(() => requestLogs.id),
    captureStatus: text('captureStatus').notNull(),
    clientRequest: text('clientRequest'),
    clientResponse: text('clientResponse'),
    attempts: text('attempts'),
    conversion: text('conversion'),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [index('idx_request_contents_updated_time').on(table.updatedTime)],
)

export type ProviderRow = typeof providers.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type UpstreamModelRow = typeof upstreamModels.$inferSelect
export type ProviderHealthRow = typeof providerHealth.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type RequestLogRow = typeof requestLogs.$inferSelect
export type RequestAttemptRow = typeof requestAttempts.$inferSelect
export type RequestContentRow = typeof requestContents.$inferSelect
