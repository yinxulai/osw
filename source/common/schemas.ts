import { z } from 'zod'

// ========== 枚举 ==========

export const ProtocolSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])
export type Protocol = z.infer<typeof ProtocolSchema>

export const RuleStageSchema = z.enum(['request', 'response'])
export type RuleStage = z.infer<typeof RuleStageSchema>
export const RuleScopeSchema = z.enum(['global', 'model']).default('model')
export type RuleScope = z.infer<typeof RuleScopeSchema>

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]))
export const RequestRewriteRuleMatchSchema = z.object({
  clientProtocols: z.array(ProtocolSchema).max(3).default([]),
  upstreamProtocols: z.array(ProtocolSchema).max(3).default([]),
})
export type RequestRewriteRuleMatch = z.infer<typeof RequestRewriteRuleMatchSchema>
export const RequestRewriteRuleTestCaseSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  stage: RuleStageSchema.default('request'),
  body: z.string().max(2 * 1024 * 1024),
  headers: z.string().max(64 * 1024),
  clientProtocol: ProtocolSchema.default('openai-completions'),
  upstreamProtocol: ProtocolSchema.default('openai-completions'),
  streaming: z.boolean().default(false),
})
export type RequestRewriteRuleTestCase = z.infer<typeof RequestRewriteRuleTestCaseSchema>
const RequestRewriteRuleActionBaseSchema = z.object({ stage: RuleStageSchema.default('request') })
export const RequestRewriteRuleActionSchema = z.discriminatedUnion('type', [
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-set'), name: z.string().min(1).max(128), value: z.string().max(4096) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-append'), name: z.string().min(1).max(128), value: z.string().max(4096) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-remove'), name: z.string().min(1).max(128) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-set'), path: z.string().min(3).max(512), value: JsonValueSchema }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-delete'), path: z.string().min(3).max(512) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-replace'), path: z.string().min(3).max(512), search: z.string().max(4096), replacement: z.string().max(4096), regex: z.boolean().default(false) }),
])
export type RequestRewriteRuleAction = z.infer<typeof RequestRewriteRuleActionSchema>
export const RequestRewriteRuleSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(100), description: z.string().max(1000).default(''), enabled: z.boolean().default(true),
  scope: RuleScopeSchema, schemaVersion: z.number().int().positive().default(1), source: z.enum(['user', 'builtin', 'imported']).default('user'), match: RequestRewriteRuleMatchSchema.default({}),
  actions: z.array(RequestRewriteRuleActionSchema).min(1).max(50),
  testCases: z.array(RequestRewriteRuleTestCaseSchema).max(50).default([]),
  createdTime: z.number().int(), updatedTime: z.number().int(), deletedTime: z.number().int().nullable(),
})
export type RequestRewriteRule = z.infer<typeof RequestRewriteRuleSchema>
export const ProviderModelRequestRewriteRuleSchema = z.object({ providerModelId: z.string(), ruleId: z.string(), priority: z.number().int().nonnegative(), enabled: z.boolean().default(true), createdTime: z.number().int(), updatedTime: z.number().int(), deletedTime: z.number().int().nullable() })
export type ProviderModelRequestRewriteRule = z.infer<typeof ProviderModelRequestRewriteRuleSchema>

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
  strategy: z.string().min(1).default('priority'),
  priority: z.number().int(),
  weight: z.number().int().positive(),
  enabled: z.boolean().default(true),
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
  endpointUrl: z.string().default(''),
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

export const HealthSnapshotSchema = z.object({
  providers: z.array(ProviderHealthSchema),
  providerModels: z.array(ProviderModelHealthSchema),
})
export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>

// ========== Settings ==========

export const OutboundProxyModeSchema = z.enum(['direct', 'system', 'custom'])
export type OutboundProxyMode = z.infer<typeof OutboundProxyModeSchema>

export const SettingsSchema = z.object({
  id: z.literal('singleton'),
  listenHost: z.string().default('127.0.0.1'),
  listenPort: z.number().int().min(1).max(65535).default(9300),
  logRetentionDays: z.number().int().positive().default(30),
  captureRequestContent: z.boolean().default(true),
  cooldownBaseSeconds: z.number().int().positive().default(30),
  cooldownMaxSeconds: z.number().int().positive().default(300),
  consecutiveFailureThreshold: z.number().int().positive().default(3),
  idleTimeoutMilliseconds: z.number().int().positive().default(30000),
  outboundProxyMode: OutboundProxyModeSchema.default('system'),
  outboundProxyUrl: z.string().default(''),
  outboundProxyBypass: z.string().default('localhost,127.0.0.1,::1'),
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
  clientProtocol: ProtocolSchema,
  upstreamProtocol: ProtocolSchema.nullable(),
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().nullable(),
  promptCacheHit: z.boolean().nullable(),
  rawUsage: RawUsageSchema.nullable(),
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  cacheHit: z.boolean().nullable(),
  createdTime: z.number().int(),
})
export type RequestLog = z.infer<typeof RequestLogSchema>
export type RequestLogUpdate = Partial<Pick<RequestLog, 'status' | 'upstreamProtocol' | 'totalDurationMilliseconds' | 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheCreationInputTokens' | 'reasoningTokens' | 'promptCacheHit' | 'rawUsage' | 'ttftMilliseconds' | 'cacheHit'>>

export const RequestAttributeValueTypeSchema = z.enum(['string', 'number', 'boolean', 'json'])
export type RequestAttributeValueType = z.infer<typeof RequestAttributeValueTypeSchema>

export const RequestAttributeSchema = z.object({
  requestId: z.string().startsWith('req_'),
  key: z.string().min(1).max(128),
  value: z.string().max(4096),
  valueType: RequestAttributeValueTypeSchema,
  createdTime: z.number().int(),
})
export type RequestAttribute = z.infer<typeof RequestAttributeSchema>

// ========== Request Attempt ==========

export const RequestAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  requestId: z.string().startsWith('req_'),
  providerId: z.string().startsWith('prov_'),
  providerModelId: z.string(),
  providerName: z.string(),
  providerModelName: z.string(),
  upstreamProtocol: ProtocolSchema.nullable(),
  upstreamRequestId: z.string().nullable(),
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
  requestRewriteRuleIds: z.array(z.string()).default([]),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type RequestContent = z.infer<typeof RequestContentSchema>

export const RequestConversionSchema = z.object({
  id: z.string().startsWith('conversion_'),
  requestId: z.string().startsWith('req_'),
  attemptId: z.string().startsWith('att_'),
  clientProtocol: ProtocolSchema,
  upstreamProtocol: ProtocolSchema,
  clientRequestHeaders: z.string().nullable(),
  upstreamRequestHeaders: z.string().nullable(),
  upstreamResponseHeaders: z.string().nullable(),
  clientResponseHeaders: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseBody: z.string().nullable(),
  streaming: z.boolean(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestConversion = z.infer<typeof RequestConversionSchema>

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
  'SYSTEM_PROXY_RESOLUTION_FAILED',
  'OUTBOUND_PROXY_UNREACHABLE',
  'OUTBOUND_PROXY_AUTH_REQUIRED',
  'OUTBOUND_PROXY_TUNNEL_REJECTED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'CLIENT_REQUEST_ABORTED',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// ========== 请求日志条目（含 attempt + providerName，用于列表展示） ==========

export const RequestLogEntryAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  attemptIndex: z.number().int().nonnegative(),
  status: RequestStatusSchema,
  providerId: z.string(),
  providerName: z.string(),
  providerModelId: z.string(),
  providerModelName: z.string(),
  upstreamProtocol: ProtocolSchema.nullable(),
  upstreamRequestId: z.string().nullable(),
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
  clientProtocol: ProtocolSchema,
  upstreamProtocol: ProtocolSchema.nullable(),
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
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

export const AppliedRequestRewriteRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type AppliedRequestRewriteRule = z.infer<typeof AppliedRequestRewriteRuleSchema>

export const RequestLogDetailSchema = RequestLogEntrySchema.extend({
  contents: z.array(RequestContentSchema),
  conversions: z.array(RequestConversionSchema),
  requestRewriteRules: z.array(AppliedRequestRewriteRuleSchema),
})
export type RequestLogDetail = z.infer<typeof RequestLogDetailSchema>

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
  label: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
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
  providerModelName: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  avgTtftMs: z.number().nonnegative().nullable(),
  avgTps: z.number().nonnegative().nullable(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
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

export const RequestSourceStatSchema = z.object({
  source: z.string(),
  category: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
})
export type RequestSourceStat = z.infer<typeof RequestSourceStatSchema>

export const AnalyticsSummarySchema = z.object({
  summary: StatsSummarySchema,
  trend: z.array(DailyTrendPointSchema),
  providerStats: z.array(ProviderStatSchema),
  modelStats: z.array(ModelStatSchema),
  latencyDistribution: z.array(LatencyBucketSchema),
  failureReasons: z.array(FailureReasonStatSchema),
  sourceStats: z.array(RequestSourceStatSchema),
})
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>
