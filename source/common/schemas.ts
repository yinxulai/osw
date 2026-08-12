import { z } from 'zod'

// ========== 枚举 ==========

export const ProtocolSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])
export type Protocol = z.infer<typeof ProtocolSchema>

export const RequestStatusSchema = z.enum(['success', 'failed', 'cancelled'])
export type RequestStatus = z.infer<typeof RequestStatusSchema>

// ========== Provider ==========

export const ProviderSchema = z.object({
  id: z.string().startsWith('prov_'),
  name: z.string().min(1).max(100),
  apiKeyReference: z.string(),
  timeoutMilliseconds: z.number().int().positive().default(30000),
  enabled: z.boolean().default(true),
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

// ========== Model Binding ==========

export const ModelBindingSchema = z.object({
  id: z.string().startsWith('bind_'),
  logicalModelId: z.string().startsWith('model_'),
  providerId: z.string().startsWith('prov_'),
  protocol: ProtocolSchema,
  upstreamUrl: z.string().url(),
  upstreamModelId: z.string().min(1),
  priority: z.number().int().positive(),
  enabled: z.boolean().default(true),
  customAuthHeader: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type ModelBinding = z.infer<typeof ModelBindingSchema>

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
  bindingId: z.string().startsWith('bind_'),
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
