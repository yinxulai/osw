import { z } from 'zod'
import { ProtocolSchema } from '@common/schemas'

const ProviderEndpointsSchema = z.record(ProtocolSchema, z.string().url())

export const ImportConfigSchema = z.object({
  config: z.object({
    schemaVersion: z.literal(3),
    settings: z.object({
      listenHost: z.string().optional(),
      listenPort: z.number().int().min(1).max(65535).optional(),
      logRetentionDays: z.number().int().positive().optional(),
      captureRequestContent: z.boolean().optional(),
      cooldownBaseSeconds: z.number().int().positive().optional(),
      cooldownMaxSeconds: z.number().int().positive().optional(),
      consecutiveFailureThreshold: z.number().int().positive().optional(),
      idleTimeoutMilliseconds: z.number().int().positive().optional(),
      autoLaunch: z.boolean().optional(),
    }).default({}),
    providers: z.array(z.object({
      id: z.string().optional(), name: z.string(), timeoutMilliseconds: z.number().int().positive().optional(),
      enabled: z.boolean().optional(), apiKey: z.string().optional(), endpoints: ProviderEndpointsSchema.optional(),
    })).default([]),
    logicalModels: z.array(z.object({
      id: z.string().optional(), name: z.string(), description: z.string().optional(), enabled: z.boolean().optional(),
    })).default([]),
    providerModels: z.array(z.object({
      id: z.string().optional(), providerId: z.string(), modelName: z.string(), enabled: z.boolean().optional(),
      endpoints: z.array(z.object({
        protocol: ProtocolSchema, url: z.string().nullable().optional(), enabled: z.boolean().optional(),
        conversions: z.array(z.object({ clientProtocol: ProtocolSchema, enabled: z.boolean().optional() })).optional(),
      })).optional(),
    })).default([]),
    schedulingPolicies: z.array(z.object({
      logicalModelId: z.string(), providerModelId: z.string(), strategy: z.string().optional(), priority: z.number().int(),
      weight: z.number().int().optional(), enabled: z.boolean().optional(),
    })).default([]),
  }),
  mode: z.enum(['merge', 'replace']).default('merge'),
})
