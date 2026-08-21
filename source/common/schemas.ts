import { z } from 'zod'

// ========== 枚举 ==========

export const ProtocolSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])
export type Protocol = z.infer<typeof ProtocolSchema>

export const RequestStatusSchema = z.enum(['pending', 'success', 'failed', 'cancelled'])
export type RequestStatus = z.infer<typeof RequestStatusSchema>

// ========== Provider ==========

export const ProviderSchema = z.object({
  id: z.string().startsWith('prov_'),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  description: z.string().default('').optional(),
  apiKeyReference: z.string(),
  timeoutMilliseconds: z.number().int().positive().default(30000),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type Provider = z.infer<typeof ProviderSchema>

export const ProviderSettingSchema = z.object({
  providerId: z.string().startsWith('prov_'),
  key: z.string().min(1),
  value: z.string(),
  valueType: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  updatedTime: z.number().int(),
})
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>

export const ProviderEndpointSchema = z.object({
  id: z.string(),
  providerId: z.string().startsWith('prov_'),
  protocol: ProtocolSchema,
  url: z.string().url(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type ProviderEndpoint = z.infer<typeof ProviderEndpointSchema>

export const ProviderModelSchema = z.object({
  id: z.string(),
  providerId: z.string().startsWith('prov_'),
  modelName: z.string().min(1),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type ProviderModel = z.infer<typeof ProviderModelSchema>

export const ProviderModelEndpointSchema = z.object({
  id: z.string(),
  providerModelId: z.string(),
  providerEndpointId: z.string(),
  url: z.string().url().nullable(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type ProviderModelEndpoint = z.infer<typeof ProviderModelEndpointSchema>

export const ProtocolConverterSchema = z.object({
  id: z.string(),
  providerModelEndpointId: z.string(),
  clientProtocol: ProtocolSchema,
  enabled: z.boolean().default(false),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type ProtocolConverter = z.infer<typeof ProtocolConverterSchema>

export const SchedulingPolicySchema = z.object({
  logicalModelId: z.string(),
  providerModelId: z.string(),
  strategy: z.string().default('priority'),
  priority: z.number().int(),
  weight: z.number().int(),
  enabled: z.boolean().default(true),
  failoverEnabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type SchedulingPolicy = z.infer<typeof SchedulingPolicySchema>

// ========== Logical Model ==========

export const LogicalModelSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type LogicalModel = z.infer<typeof LogicalModelSchema>

// ========== Provider Model ==========

/** Protocol endpoint configuration for a provider model route. */
export const ProtocolEndpointSchema = z.object({
  protocol: ProtocolSchema,
  upstreamUrl: z.string().default(''),
  customAuthHeader: z.string().nullable().default(null),
  protocolConversionEnabled: z.boolean().default(false),
})
export type ProviderModelRouteEndpoint = z.infer<typeof ProtocolEndpointSchema>

export const ProviderModelRouteSchema = z.object({
  id: z.string(),
  providerId: z.string().startsWith('prov_'),
  modelName: z.string().min(1),
  endpoints: z.array(ProtocolEndpointSchema).default([]),
  priority: z.number().int(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type ProviderModelRoute = z.infer<typeof ProviderModelRouteSchema>

// ========== Provider Health ==========

export const ProviderHealthSchema = z.object({
  providerId: z.string().startsWith('prov_'),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  cooldownUntilTime: z.number().int().nullable(),
  lastSuccessTime: z.number().int().nullable(),
  lastFailureTime: z.number().int().nullable(),
  updatedTime: z.number().int(),
})
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>

export const ProviderModelHealthSchema = ProviderHealthSchema.omit({ providerId: true }).extend({ providerModelId: z.string() })
export type ProviderModelHealth = z.infer<typeof ProviderModelHealthSchema>

// ========== Settings ==========

export const SettingsSchema = z.object({
  id: z.literal('singleton'),
  listenHost: z.string().default('127.0.0.1'),
  listenPort: z.number().int().min(1).max(65535).default(9300),
  accessTokenReference: z.string().nullable().default(null),
  logRetentionCount: z.number().int().positive().default(1000),
  logRetentionDays: z.number().int().positive().nullable().default(null),
  captureRequestContent: z.boolean().default(false),
  cooldownBaseSeconds: z.number().int().positive().default(30),
  cooldownMaxSeconds: z.number().int().positive().default(300),
  consecutiveFailureThreshold: z.number().int().positive().default(3),
  idleTimeoutMilliseconds: z.number().int().positive().default(30000),
  autoLaunch: z.boolean().default(false),
  updatedTime: z.number().int(),
})
export type Settings = z.infer<typeof SettingsSchema>

// ========== Request Log ==========

export const RawUsageSchema = z.record(z.unknown())
export type RawUsage = z.infer<typeof RawUsageSchema>

export const RequestLogSchema = z.object({
  id: z.string().startsWith('req_'),
  logicalModelId: z.string(),
  protocol: ProtocolSchema,
  /** 实际请求上游时使用的协议；与 protocol 不同表示经过了协议转换 */
  upstreamProtocol: ProtocolSchema.nullable(),
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  cacheCreationInputTokens: z.number().int().nonnegative().nullable(),
  promptCacheHit: z.boolean().nullable(),
  rawUsage: RawUsageSchema.nullable(),
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  cacheHit: z.boolean().nullable(),
  createdTime: z.number().int(),
})
export type RequestLog = z.infer<typeof RequestLogSchema>

// ========== Request Attempt ==========

export const RequestAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  requestId: z.string().startsWith('req_'),
  providerId: z.string().startsWith('prov_'),
  providerModelId: z.string(),
  providerName: z.string(),
  providerModelName: z.string(),
  providerProtocol: ProtocolSchema.nullable(),
  providerRequestId: z.string().nullable(),
  url: z.string(),
  attemptIndex: z.number().int().nonnegative(),
  status: RequestStatusSchema,
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  details: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestAttempt = z.infer<typeof RequestAttemptSchema>

export const RequestContentCaptureStatusSchema = z.enum(['captured', 'partial', 'disabled', 'failed'])
export type RequestContentCaptureStatus = z.infer<typeof RequestContentCaptureStatusSchema>

export const RequestContentSchema = z.object({
  id: z.string().startsWith('content_'),
  requestId: z.string().startsWith('req_'),
  attemptId: z.string().startsWith('att_').nullable(),
  captureStatus: RequestContentCaptureStatusSchema,
  requestMethod: z.string(),
  requestPath: z.string(),
  requestHeaders: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  responseHeaders: z.string().nullable(),
  responseBody: z.string().nullable(),
  conversions: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type RequestContent = z.infer<typeof RequestContentSchema>

// ========== API 响应结构 ==========

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  errorCode: z.string(),
  errorMessage: z.string(),
})

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([ApiSuccessSchema(dataSchema), ApiErrorSchema])

export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; errorCode: string; errorMessage: string }
export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ========== API 错误码（统一枚举） ==========

export const ApiErrorCodeSchema = z.enum([
  // 通用
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'HTTP_ERROR',
  // 认证
  'UNAUTHORIZED',
  'FORBIDDEN',
  // 资源
  'RESOURCE_NOT_FOUND',
  'DUPLICATE_RESOURCE',
  // 代理
  'UNKNOWN_API_PATH',
  'UPSTREAM_ERROR',
  'ALL_PROVIDERS_FAILED',
  'PROXY_NOT_RUNNING',
  'NO_MODEL_CONFIGURED',
  'PROXY_INTERNAL_ERROR',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// ========== 请求日志条目（含 attempt + providerName，用于列表展示） ==========

export const RequestLogEntryAttemptSchema = z.object({
  attemptIndex: z.number().int().nonnegative(),
  status: RequestStatusSchema,
  providerId: z.string(),
  providerName: z.string(),
  providerModelId: z.string(),
  providerModelName: z.string(),
  providerProtocol: ProtocolSchema.nullable(),
  providerRequestId: z.string().nullable(),
  url: z.string(),
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  details: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestLogEntryAttempt = z.infer<typeof RequestLogEntryAttemptSchema>

export const RequestLogEntrySchema = z.object({
  id: z.string().startsWith('req_'),
  logicalModelId: z.string(),
  protocol: ProtocolSchema,
  upstreamProtocol: ProtocolSchema.nullable(),
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  cacheCreationInputTokens: z.number().int().nonnegative().nullable(),
  promptCacheHit: z.boolean().nullable(),
  rawUsage: RawUsageSchema.nullable(),
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  cacheHit: z.boolean().nullable(),
  createdTime: z.number().int(),
  attempts: z.array(RequestLogEntryAttemptSchema),
})
export type RequestLogEntry = z.infer<typeof RequestLogEntrySchema>

// ========== 运行日志条目 ==========

export const LogEntrySchema = z.object({
  id: z.number().int().positive(),
  level: z.enum(['log', 'warn', 'error', 'info', 'debug']),
  message: z.string(),
  timestamp: z.number().int(),
})
export type LogEntry = z.infer<typeof LogEntrySchema>

// ========== 代理服务状态 ==========

export const ProxyServerStatusSchema = z.object({
  running: z.boolean(),
  host: z.string(),
  port: z.number().int(),
})
export type ProxyServerStatus = z.infer<typeof ProxyServerStatusSchema>

// ========== 统计分析 ==========

export const AnalyticsRangeSchema = z.enum(['today', '7d', '30d'])
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>

export const StatsSummarySchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
export type StatsSummary = z.infer<typeof StatsSummarySchema>

export const DailyTrendPointSchema = z.object({
  day: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
})
export type DailyTrendPoint = z.infer<typeof DailyTrendPointSchema>

export const ProviderStatSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type ProviderStat = z.infer<typeof ProviderStatSchema>

export const ModelStatSchema = z.object({
  upstreamModelId: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
})
export type ModelStat = z.infer<typeof ModelStatSchema>

export const LatencyBucketSchema = z.object({
  range: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type LatencyBucket = z.infer<typeof LatencyBucketSchema>

export const FailureReasonStatSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type FailureReasonStat = z.infer<typeof FailureReasonStatSchema>

export const AnalyticsSummarySchema = z.object({
  summary: StatsSummarySchema,
  trend: z.array(DailyTrendPointSchema),
  providerStats: z.array(ProviderStatSchema),
  modelStats: z.array(ModelStatSchema),
  latencyDistribution: z.array(LatencyBucketSchema),
  failureReasons: z.array(FailureReasonStatSchema),
})
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>
