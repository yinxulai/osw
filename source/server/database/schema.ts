import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    apiKeyReference: text('apiKeyReference').notNull(),
    timeoutMilliseconds: integer('timeoutMilliseconds').notNull().default(30000),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    upstreamUrls: text('upstreamUrls').notNull().default('{}'),
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
    logicalModelId: text('logicalModelId')
      .notNull()
      .references(() => logicalModels.id),
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
    index('idx_upstream_models_logical_priority').on(table.logicalModelId, table.priority),
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

export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    listenHost: text('listenHost').notNull().default('127.0.0.1'),
    listenPort: integer('listenPort').notNull().default(9300),
    accessTokenReference: text('accessTokenReference'),
    logRetentionCount: integer('logRetentionCount').notNull().default(1000),
    cooldownBaseSeconds: integer('cooldownBaseSeconds').notNull().default(30),
    cooldownMaxSeconds: integer('cooldownMaxSeconds').notNull().default(300),
    consecutiveFailureThreshold: integer('consecutiveFailureThreshold').notNull().default(3),
    idleTimeoutMilliseconds: integer('idleTimeoutMilliseconds').notNull().default(30000),
    autoLaunch: integer('autoLaunch', { mode: 'boolean' }).notNull().default(false),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [check('settings_singleton_id', sql`${table.id} = 'singleton'`)],
)

export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: text('id').primaryKey(),
    logicalModelId: text('logicalModelId').notNull(),
    protocol: text('protocol').notNull(),
    status: text('status').notNull(),
    totalDurationMilliseconds: integer('totalDurationMilliseconds').notNull(),
    totalTokens: integer('totalTokens'),
    inputTokens: integer('inputTokens'),
    outputTokens: integer('outputTokens'),
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

export type ProviderRow = typeof providers.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type UpstreamModelRow = typeof upstreamModels.$inferSelect
export type ProviderHealthRow = typeof providerHealth.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type RequestLogRow = typeof requestLogs.$inferSelect
export type RequestAttemptRow = typeof requestAttempts.$inferSelect
