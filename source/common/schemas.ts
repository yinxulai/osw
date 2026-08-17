import { z } from 'zod'

// ========== 枚举 ==========

export const ProtocolSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])
export type Protocol = z.infer<typeof ProtocolSchema>

/** 供应商按协议配置的默认接口地址表 */
export const UpstreamUrlsSchema = z.record(ProtocolSchema, z.string().url())
export type UpstreamUrls = z.infer<typeof UpstreamUrlsSchema>

export const RequestStatusSchema = z.enum(['success', 'failed', 'cancelled'])
export type RequestStatus = z.infer<typeof RequestStatusSchema>

// ========== Provider ==========

export const ProviderSchema = z.object({
  id: z.string().startsWith('prov_'),
  name: z.string().min(1).max(100),
  apiKeyReference: z.string(),
  timeoutMilliseconds: z.number().int().positive().default(30000),
  enabled: z.boolean().default(true),
  upstreamUrls: z.string().default('{}'),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type Provider = z.infer<typeof ProviderSchema>

// ========== Logical Model ==========

export const LogicalModelSchema = z.object({
  id: z.string().startsWith('model_'),
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type LogicalModel = z.infer<typeof LogicalModelSchema>

// ========== Upstream Model ==========

/**
 * 单个上游协议端点配置。
 * 同一上游模型可通过多个协议访问，每个协议是一个端点。
 */
export const ProtocolEndpointSchema = z.object({
  protocol: ProtocolSchema,
  /** 完整接口地址；留空则回退到供应商在该协议下的默认地址 */
  upstreamUrl: z.string().default(''),
  /** 自定义认证请求头名称；为空则按协议标准方式认证 */
  customAuthHeader: z.string().nullable(),
})
export type ProtocolEndpoint = z.infer<typeof ProtocolEndpointSchema>

/**
 * 上游模型：一个 (供应商 × 上游模型名) 的实体，内部可挂多个协议端点。
 * 一个模型只占队列中的一行，即使支持多个协议。
 */
export const UpstreamModelSchema = z.object({
  id: z.string().startsWith('model_'),
  logicalModelId: z.string().startsWith('model_'),
  providerId: z.string().startsWith('prov_'),
  upstreamModelId: z.string().min(1),
  /** 协议端点列表，一个模型可支持多个协议 */
  endpoints: z.array(ProtocolEndpointSchema).default([]),
  priority: z.number().int().positive(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type UpstreamModel = z.infer<typeof UpstreamModelSchema>

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

// ========== Settings ==========

export const SettingsSchema = z.object({
  id: z.literal('singleton'),
  listenHost: z.string().default('127.0.0.1'),
  listenPort: z.number().int().min(1).max(65535).default(9300),
  accessTokenReference: z.string().nullable(),
  logRetentionCount: z.number().int().positive().default(1000),
  cooldownBaseSeconds: z.number().int().positive().default(30),
  cooldownMaxSeconds: z.number().int().positive().default(300),
  consecutiveFailureThreshold: z.number().int().positive().default(3),
  idleTimeoutMilliseconds: z.number().int().positive().default(30000),
  autoLaunch: z.boolean().default(false),
  updatedTime: z.number().int(),
})
export type Settings = z.infer<typeof SettingsSchema>

// ========== Request Log ==========

export const RequestLogSchema = z.object({
  id: z.string().startsWith('req_'),
  logicalModelId: z.string().startsWith('model_'),
  protocol: ProtocolSchema,
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
  createdTime: z.number().int(),
})
export type RequestLog = z.infer<typeof RequestLogSchema>

// ========== Request Attempt ==========

export const RequestAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  requestId: z.string().startsWith('req_'),
  providerId: z.string().startsWith('prov_'),
  upstreamModelId: z.string(),
  attemptIndex: z.number().int().nonnegative(),
  status: RequestStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestAttempt = z.infer<typeof RequestAttemptSchema>

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
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// ========== 请求日志条目（含 attempt + providerName，用于列表展示） ==========

export const RequestLogEntryAttemptSchema = z.object({
  attemptIndex: z.number().int().nonnegative(),
  status: RequestStatusSchema,
  providerId: z.string(),
  providerName: z.string(),
  upstreamModelId: z.string(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestLogEntryAttempt = z.infer<typeof RequestLogEntryAttemptSchema>

export const RequestLogEntrySchema = z.object({
  id: z.string().startsWith('req_'),
  logicalModelId: z.string(),
  protocol: ProtocolSchema,
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
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
