import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const settings = sqliteTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    valueType: text('valueType').notNull().default('string'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [index('idx_settings_updated_time').on(table.updatedTime)],
)

export const providers = sqliteTable(
  'providers',
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
    index('idx_providers_enabled').on(table.enabled),
    index('idx_providers_deleted_time').on(table.deletedTime),
  ],
)

export const providerHealth = sqliteTable('provider_health', {
  providerId: text('providerId').primaryKey().references(() => providers.id),
  consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
  cooldownUntilTime: integer('cooldownUntilTime'),
  lastSuccessTime: integer('lastSuccessTime'),
  lastFailureTime: integer('lastFailureTime'),
  updatedTime: integer('updatedTime').notNull(),
})

export const providerSettings = sqliteTable(
  'provider_settings',
  {
    providerId: text('providerId').notNull().references(() => providers.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    valueType: text('valueType').notNull().default('string'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.providerId, table.key] }),
    index('idx_provider_settings_key').on(table.key),
  ],
)

export const providerEndpoints = sqliteTable(
  'provider_endpoints',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull().references(() => providers.id),
    protocol: text('protocol').notNull(),
    url: text('url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_provider_endpoints_provider_protocol').on(table.providerId, table.protocol),
    index('idx_provider_endpoints_protocol').on(table.protocol, table.enabled),
  ],
)

export const providerModels = sqliteTable(
  'provider_models',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull().references(() => providers.id),
    modelName: text('modelName').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    uniqueIndex('idx_provider_models_provider_model_active')
      .on(table.providerId, table.modelName)
      .where(sql`deletedTime IS NULL`),
    index('idx_provider_models_enabled').on(table.providerId, table.enabled, table.deletedTime),
  ],
)

export const providerModelHealth = sqliteTable('provider_model_health', {
  providerModelId: text('providerModelId').primaryKey().references(() => providerModels.id),
  consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
  cooldownUntilTime: integer('cooldownUntilTime'),
  lastSuccessTime: integer('lastSuccessTime'),
  lastFailureTime: integer('lastFailureTime'),
  updatedTime: integer('updatedTime').notNull(),
})

export const providerModelEndpoints = sqliteTable(
  'provider_model_endpoints',
  {
    id: text('id').primaryKey(),
    providerModelId: text('providerModelId').notNull().references(() => providerModels.id),
    providerEndpointId: text('providerEndpointId').notNull().references(() => providerEndpoints.id),
    url: text('url'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_provider_model_endpoints_unique').on(table.providerModelId, table.providerEndpointId),
    index('idx_provider_model_endpoints_provider_endpoint').on(table.providerEndpointId, table.enabled),
  ],
)

export const protocolConverters = sqliteTable(
  'protocol_converters',
  {
    id: text('id').primaryKey(),
    providerModelEndpointId: text('providerModelEndpointId').notNull().references(() => providerModelEndpoints.id),
    clientProtocol: text('clientProtocol').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_protocol_converters_unique').on(table.providerModelEndpointId, table.clientProtocol),
    index('idx_protocol_converters_protocol').on(table.clientProtocol, table.enabled),
  ],
)

export const logicalModels = sqliteTable(
  'logical_models',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [index('idx_logical_models_enabled').on(table.enabled), index('idx_logical_models_deleted_time').on(table.deletedTime)],
)

export const schedulingPolicies = sqliteTable(
  'scheduling_policies',
  {
    logicalModelId: text('logicalModelId').notNull().references(() => logicalModels.id),
    providerModelId: text('providerModelId').notNull().references(() => providerModels.id),
    strategy: text('strategy').notNull().default('priority'),
    priority: integer('priority').notNull().default(0),
    weight: integer('weight').notNull().default(100),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.logicalModelId, table.providerModelId] }),
    index('idx_scheduling_policies_route').on(table.logicalModelId, table.enabled, table.priority, table.weight),
  ],
)

export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    protocol: text('protocol').notNull(),
    logicalModelId: text('logicalModelId').notNull(),
    metadata: text('metadata'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [index('idx_request_logs_created_time').on(table.createdTime), index('idx_request_logs_status').on(table.status), index('idx_request_logs_logical_model').on(table.logicalModelId)],
)

export const requestMetrics = sqliteTable(
  'request_metrics',
  {
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    key: text('key').notNull(),
    value: real('value').notNull(),
    unit: text('unit').notNull().default('count'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [primaryKey({ columns: [table.requestId, table.key] }), index('idx_request_metrics_key').on(table.key)],
)

export const requestUsages = sqliteTable(
  'request_usages',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    attemptId: text('attemptId'),
    type: text('type').notNull(),
    value: real('value').notNull(),
    unit: text('unit').notNull().default('count'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [index('idx_request_usages_type_time').on(table.type, table.createdTime), index('idx_request_usages_request').on(table.requestId), index('idx_request_usages_attempt').on(table.attemptId)],
)

export const requestAttempts = sqliteTable(
  'request_attempts',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    providerId: text('providerId').notNull(),
    providerModelId: text('providerModelId').notNull(),
    providerName: text('providerName').notNull(),
    providerModelName: text('providerModelName').notNull(),
    providerProtocol: text('providerProtocol'),
    providerRequestId: text('providerRequestId'),
    url: text('url').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('httpStatus'),
    retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
    attemptIndex: integer('attemptIndex').notNull(),
    durationMilliseconds: integer('durationMilliseconds').notNull(),
    errorCode: text('errorCode'),
    errorMessage: text('errorMessage'),
    details: text('details'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    uniqueIndex('idx_request_attempts_request_order').on(table.requestId, table.attemptIndex),
    index('idx_request_attempts_provider_time').on(table.providerId, table.createdTime),
    index('idx_request_attempts_model_time').on(table.providerModelId, table.createdTime),
  ],
)

export const requestContents = sqliteTable(
  'request_contents',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    attemptId: text('attemptId'),
    captureStatus: text('captureStatus').notNull(),
    requestMethod: text('requestMethod').notNull(),
    requestPath: text('requestPath').notNull(),
    requestHeaders: text('requestHeaders'),
    requestBody: text('requestBody'),
    responseStatus: integer('responseStatus'),
    responseHeaders: text('responseHeaders'),
    responseBody: text('responseBody'),
    conversions: text('conversions'),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_request_contents_request_level').on(table.requestId).where(sql`attemptId IS NULL`),
    uniqueIndex('idx_request_contents_attempt').on(table.attemptId).where(sql`attemptId IS NOT NULL`),
  ],
)

export type ProviderRow = typeof providers.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type ProviderModelRow = typeof providerModels.$inferSelect
export type ProviderHealthRow = typeof providerHealth.$inferSelect
export type ProviderModelHealthRow = typeof providerModelHealth.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type ProviderSettingRow = typeof providerSettings.$inferSelect
export type ProviderEndpointRow = typeof providerEndpoints.$inferSelect
export type ProviderModelEndpointRow = typeof providerModelEndpoints.$inferSelect
export type ProtocolConverterRow = typeof protocolConverters.$inferSelect
export type SchedulingPolicyRow = typeof schedulingPolicies.$inferSelect
export type RequestLogRow = typeof requestLogs.$inferSelect
export type RequestMetricRow = typeof requestMetrics.$inferSelect
export type RequestUsageRow = typeof requestUsages.$inferSelect
export type RequestAttemptRow = typeof requestAttempts.$inferSelect
export type RequestContentRow = typeof requestContents.$inferSelect
