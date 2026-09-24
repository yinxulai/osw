import { z } from 'zod'
import { ProtocolSchema } from './schemas'

/**
 * 供应商包（provider bundle）的格式标识。
 *
 * 单独用一个字面量字段而不是只看版本号：导入时必须能一眼判断「这是不是一个供应商导出文件」，
 * 否则用户把别的导出文件拖进来时，只能得到一条含糊的字段校验错误。
 */
export const PROVIDER_BUNDLE_FORMAT = 'osw/provider-bundle'

/**
 * 供应商包版本。
 *
 * 这里是字面量而不是可升级的联合类型：导入只接受当前这一个值，换代时把它改成 `2`，
 * 让上一代的文件明确报错，而不是被猜着读。
 */
export const PROVIDER_BUNDLE_VERSION = 1

const ProviderBundleEndpointSchema = z.object({
  protocol: ProtocolSchema,
  /** 空串表示供应商这一层还没有这个协议的默认地址（协议载体行，见 `schemas.ts` 的同名字段）。 */
  url: z.string(),
  enabled: z.boolean().default(true),
})

const ProviderBundleModelEndpointSchema = z.object({
  protocol: ProtocolSchema,
  url: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  protocolConversionEnabled: z.boolean().default(false),
})

const ProviderBundleModelSchema = z.object({
  modelName: z.string().min(1),
  enabled: z.boolean().default(true),
  endpoints: z.array(ProviderBundleModelEndpointSchema).default([]),
})

const ProviderBundleSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  valueType: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
})

/** 单个供应商条目。云同步的配置快照直接复用同一份定义，因此这里导出。 */
export const ProviderBundleProviderSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  timeoutMilliseconds: z.number().int().positive().default(30000),
  /** 明文 API Key。导出时由用户决定是否包含，导入时缺省表示「保留目标环境已有的密钥」。 */
  apiKey: z.string().optional(),
  endpoints: z.array(ProviderBundleEndpointSchema).default([]),
  settings: z.array(ProviderBundleSettingSchema).default([]),
  models: z.array(ProviderBundleModelSchema).default([]),
})

export const ProviderBundleSchema = z.object({
  format: z.literal(PROVIDER_BUNDLE_FORMAT),
  version: z.literal(PROVIDER_BUNDLE_VERSION),
  exportedAt: z.number().int(),
  providers: z.array(ProviderBundleProviderSchema).min(1),
})

export const ProviderBundleExportRequestSchema = z.object({
  /** 省略即导出全部未删除的供应商（含已停用）。 */
  providerIds: z.array(z.string()).optional(),
  includeApiKeys: z.boolean().default(false),
})

export const ProviderBundleImportRequestSchema = z.object({ bundle: ProviderBundleSchema })

export type ProviderBundleEndpoint = z.infer<typeof ProviderBundleEndpointSchema>
export type ProviderBundleModelEndpoint = z.infer<typeof ProviderBundleModelEndpointSchema>
export type ProviderBundleModel = z.infer<typeof ProviderBundleModelSchema>
export type ProviderBundleSetting = z.infer<typeof ProviderBundleSettingSchema>
export type ProviderBundleProvider = z.infer<typeof ProviderBundleProviderSchema>
export type ProviderBundle = z.infer<typeof ProviderBundleSchema>
export type ProviderBundleExportRequest = z.infer<typeof ProviderBundleExportRequestSchema>
export type ProviderBundleImportRequest = z.infer<typeof ProviderBundleImportRequestSchema>
