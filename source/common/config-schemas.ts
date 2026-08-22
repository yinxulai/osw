import { z } from 'zod'
import { ProtocolSchema } from './schemas'

const ConfigProviderEndpointsSchema = z.record(ProtocolSchema, z.string().url())

const ConfigSettingsSchema = z.object({
  listenHost: z.string().optional(),
  listenPort: z.number().int().min(1).max(65535).optional(),
  logRetentionDays: z.number().int().positive().optional(),
  captureRequestContent: z.boolean().optional(),
  cooldownBaseSeconds: z.number().int().positive().optional(),
  cooldownMaxSeconds: z.number().int().positive().optional(),
  consecutiveFailureThreshold: z.number().int().positive().optional(),
  idleTimeoutMilliseconds: z.number().int().positive().optional(),
  autoLaunch: z.boolean().optional(),
})

const ConfigProviderSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  timeoutMilliseconds: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  apiKeyPlaceholder: z.string().optional(),
  endpoints: ConfigProviderEndpointsSchema.optional(),
})

const ConfigLogicalModelSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
})

const ConfigProviderModelEndpointSchema = z.object({
  protocol: ProtocolSchema,
  url: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  conversions: z.array(z.object({
    clientProtocol: ProtocolSchema,
    enabled: z.boolean().optional(),
  })).optional(),
})

const ConfigProviderModelSchema = z.object({
  id: z.string().optional(),
  providerId: z.string(),
  modelName: z.string(),
  enabled: z.boolean().optional(),
  endpoints: z.array(ConfigProviderModelEndpointSchema).optional(),
})

const ConfigSchedulingPolicySchema = z.object({
  logicalModelId: z.string(),
  providerModelId: z.string(),
  strategy: z.string().optional(),
  priority: z.number().int(),
  weight: z.number().int().optional(),
  enabled: z.boolean().optional(),
})

export const ConfigDocumentSchema = z.object({
  schemaVersion: z.literal(3),
  exportedAt: z.number().int(),
  settings: ConfigSettingsSchema.default({}),
  providers: z.array(ConfigProviderSchema).default([]),
  logicalModels: z.array(ConfigLogicalModelSchema).default([]),
  providerModels: z.array(ConfigProviderModelSchema).default([]),
  schedulingPolicies: z.array(ConfigSchedulingPolicySchema).default([]),
})

export const ConfigImportRequestSchema = z.object({
  config: ConfigDocumentSchema,
  mode: z.enum(['merge', 'replace']).default('merge'),
})

export type ConfigSettings = z.infer<typeof ConfigSettingsSchema>
export type ConfigProvider = z.infer<typeof ConfigProviderSchema>
export type ConfigLogicalModel = z.infer<typeof ConfigLogicalModelSchema>
export type ConfigProviderModel = z.infer<typeof ConfigProviderModelSchema>
export type ConfigSchedulingPolicy = z.infer<typeof ConfigSchedulingPolicySchema>
export type ConfigDocument = z.infer<typeof ConfigDocumentSchema>
export type ConfigImportRequest = z.infer<typeof ConfigImportRequestSchema>
