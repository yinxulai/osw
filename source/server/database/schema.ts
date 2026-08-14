import {
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

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

export const modelBindings = sqliteTable(
  'model_bindings',
  {
    id: text('id').primaryKey(),
    logicalModelId: text('logicalModelId')
      .notNull()
      .references(() => logicalModels.id),
    providerId: text('providerId')
      .notNull()
      .references(() => providers.id),
    protocol: text('protocol').notNull(),
    upstreamUrl: text('upstreamUrl').notNull().default(''),
    upstreamModelId: text('upstreamModelId').notNull(),
    priority: integer('priority').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    customAuthHeader: text('customAuthHeader'),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_bindings_logical_model_priority').on(table.logicalModelId, table.priority),
    index('idx_bindings_provider').on(table.providerId),
    index('idx_bindings_protocol').on(table.protocol),
    index('idx_bindings_deleted_time').on(table.deletedTime),
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
    updatedTime: integer('updatedTime').notNull(),
  },
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
    bindingId: text('bindingId')
      .notNull()
      .references(() => modelBindings.id),
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
    index('idx_attempts_provider').on(table.providerId),
    index('idx_attempts_created_time').on(table.createdTime),
  ],
)

export type ProviderRow = typeof providers.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type ModelBindingRow = typeof modelBindings.$inferSelect
export type ProviderHealthRow = typeof providerHealth.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type RequestLogRow = typeof requestLogs.$inferSelect
export type RequestAttemptRow = typeof requestAttempts.$inferSelect
