import { z } from 'zod'
import { ProtocolSchema } from './schemas'

/**
 * 插件契约（**纯形状，不依赖 Node**）。
 *
 * 插件是「Provider 的供给层」：它只负责产出**一条 Provider 记录**（端点、密钥、模型清单），
 * 产出之后代理、调度、协议转换、日志全部复用现有机制。首期能力只有一种：
 * `capabilities: ['provider']` —— 自定义供应商。产品语义与完整实现契约见
 * `apps/docs/specs/plugins.md`。
 *
 * 这个文件只描述**边界上流动的数据**：清单、Hook 的入/出参、界面消费的聚合视图。
 * 它不描述钩子怎么执行（那是 core 的 worker 沙箱），也不描述落库（复用 provider_settings）。
 */

// ========== 清单 ==========

/** 插件 key：小写字母起头，只含小写字母/数字/连字符。它同时是目录名与 Provider 的托管标记。 */
export const PLUGIN_KEY_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * 插件声明的能力。首期只有 `provider`（自定义供应商）。
 *
 * 保留成数组而不是布尔，是因为后续可能的扩展（如「自定义逻辑模型」）不该改清单字段名。
 */
export const PluginCapabilitySchema = z.enum(['provider'])
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>

export const PluginInputTypeSchema = z.enum(['string', 'password', 'url', 'number', 'boolean'])
export type PluginInputType = z.infer<typeof PluginInputTypeSchema>

/**
 * 一个输入项：渲染成设置行，值持久化。
 *
 * `secret: true` 的值进宿主 `SecretStore`（引用 `plugin::<key>::input::<inputKey>`），
 * **不进配置库**；其余进 `plugin.inputs`。界面回填时密钥项一律回占位符，不回明文。
 */
export const PluginInputFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: PluginInputTypeSchema.default('string'),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
})
export type PluginInputField = z.infer<typeof PluginInputFieldSchema>

/**
 * 声明式模型列表拉取（没有 `entry.js` 时的回退）。
 *
 * `url` 支持 `{{inputKey}}` 插值；`path` 是取值路径（`data[].id` / `models[].id` / 裸数组
 * `[].id`）。缺省 `path` 时按这几种常见形状自动探测（与 `provider/fetch-models` 同一思路）。
 */
export const PluginModelsSpecSchema = z.object({
  url: z.string().min(1),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  path: z.string().optional(),
})
export type PluginModelsSpec = z.infer<typeof PluginModelsSpecSchema>

/** 插件清单（`plugin.json`）。 */
export const PluginManifestSchema = z.object({
  manifestVersion: z.literal(1),
  key: z.string().regex(PLUGIN_KEY_PATTERN, 'Plugin key must match /^[a-z][a-z0-9-]*$/'),
  name: z.string().min(1),
  description: z.string().default(''),
  homepage: z.string().optional(),
  /** 自动创建的 Provider 显示名；缺省用 `name`。 */
  providerName: z.string().optional(),
  capabilities: z.array(PluginCapabilitySchema).min(1).default(['provider']),
  /** 可执行入口相对路径；文件不存在即声明式（L0）。 */
  entry: z.string().default('entry.js'),
  /** 本地开发标记：界面在详情页额外显示「重新加载」按钮。 */
  dev: z.boolean().default(false),
  /** 单次 hook 的超时上限。 */
  timeoutMilliseconds: z.number().int().positive().max(120_000).default(30_000),
  inputs: z.array(PluginInputFieldSchema).default([]),
  /**
   * 哪一个输入项是**上游的 API Key**。
   *
   * 声明式（L0）插件没有代码，只能靠这一条把「用户填的值」与「Provider 的密钥引用」连起来：
   * 同步时把这个输入项的值写进 `provider.apiKeyReference`，并在插值里额外提供 `{{apiKey}}`。
   * 不声明就等于「这个插件不需要 Key」（纯公开接口的聚合源）。
   */
  apiKeyInput: z.string().min(1).optional(),
  /** 端点模板：`{{inputKey}}` 插值；协议取自 ProtocolSchema。 */
  endpoints: z.record(ProtocolSchema, z.string()).default({}),
  models: PluginModelsSpecSchema.optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

// ========== Hook 契约 ==========

/**
 * `obtainCredential` 的返回：四态联合。
 *
 * `input-required` / `action-required` 把「代码要 Key」变成可交互流程：界面弹补充表单、
 * 打开授权页并轮询重跑。它们**不是失败**——同步暂停在该状态，已有密钥/端点继续可用。
 */
export const PluginCredentialResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    /**
     * 上游的 API Key。**允许空串**：不需要密钥的插件（纯公开接口的聚合源）也要能回 `ready`，
     * 否则它只能靠 `failed` 表达「我没问题」，那会让界面上出现一个永远红的插件。
     */
    apiKey: z.string(),
    endpointOverrides: z.record(ProtocolSchema, z.string()).optional(),
  }),
  z.object({ status: z.literal('input-required'), fields: z.array(PluginInputFieldSchema).min(1) }),
  z.object({
    status: z.literal('action-required'),
    instruction: z.string().min(1),
    actionUrl: z.string().optional(),
    pollIntervalMs: z.number().int().positive().optional(),
  }),
  z.object({ status: z.literal('failed'), message: z.string().min(1) }),
])
export type PluginCredentialResult = z.infer<typeof PluginCredentialResultSchema>

export const PluginCredentialStatusSchema = z.enum(['none', 'ok', 'input-required', 'action-required', 'error'])
export type PluginCredentialStatus = z.infer<typeof PluginCredentialStatusSchema>

/** `listModels` 的返回。`id` 是**上游真实模型名**，`name` 仅用于界面展示。 */
export const PluginModelListingSchema = z.object({ id: z.string().min(1), name: z.string().optional() })
export type PluginModelListing = z.infer<typeof PluginModelListingSchema>

export const PluginListModelsResultSchema = z.object({ models: z.array(PluginModelListingSchema) })
export type PluginListModelsResult = z.infer<typeof PluginListModelsResultSchema>

export const PluginRequestContextSchema = z.object({
  logicalModelId: z.string().min(1),
  providerModelId: z.string().min(1),
  providerModelName: z.string().min(1),
  protocol: ProtocolSchema,
  method: z.string().min(1),
  path: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().default(''),
  url: z.string().min(1),
})
export type PluginRequestContext = z.infer<typeof PluginRequestContextSchema>

export const PluginRequestResolutionResultSchema = z.object({
  url: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  customAuthHeader: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})
export type PluginRequestResolutionResult = z.infer<typeof PluginRequestResolutionResultSchema>

/**
 * 一次同步的结果（落进 `plugin.state` 的部分）。
 *
 * `lastSyncError` 只在**失败**时有值；一次成功的同步（含 `input-required` / `action-required`
 * 这种「走到一半」的中间态）都会清掉上一次的失败。
 */
export const PluginSyncStateSchema = z.object({
  credentialStatus: PluginCredentialStatusSchema.default('none'),
  credentialMessage: z.string().nullable().default(null),
  actionUrl: z.string().nullable().default(null),
  /**
   * `obtainCredential` 返回 `input-required` 时动态要求的输入项。
   *
   * 它必须落盘：这些字段不在 `plugin.json` 里（是 hook 运行时才知道要什么的），不记下来
   * 界面就无表可填，用户只能反复点「同步」看着同一句报错。
   */
  credentialFields: z.array(PluginInputFieldSchema).default([]),
  lastSyncTime: z.number().int().nullable().default(null),
  lastSyncError: z.string().nullable().default(null),
  modelCount: z.number().int().nonnegative().default(0),
  /**
   * 本插件写入过的 SecretStore 引用（含 `…::input::*` / `…::hook::*` / `…::storage::*`）。
   *
   * **必须记全称而不是名字**：`SecretStore` 只能按引用取值，没有「列出这个插件写过什么」
   * 的接口，不记下引用就等于留下永远删不掉的密钥。卸载时逐个 `delete` 即可。
   */
  secretReferences: z.array(z.string()).default([]),
})
export type PluginSyncState = z.infer<typeof PluginSyncStateSchema>

// ========== 界面聚合视图 ==========

/**
 * 插件列表项。`inputValues` 的密钥项**不返回明文**，只回一个非空占位符（`hasSecrets` 说明
 * 存在哪些密钥输入），界面据此显示「已设置」。
 */
export const PluginViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  homepage: z.string().nullable().default(null),
  providerName: z.string(),
  capabilities: z.array(PluginCapabilitySchema),
  /**
   * 这个目录装不上（`plugin.json` 缺失 / 不合法 / 目录名对不上）：有值时其余字段是占位值。
   *
   * 列表**不能因为一个坏插件就不显示**——那会让用户以为插件全都消失了，也无从知道是哪一个坏了。
   */
  error: z.string().nullable().default(null),
  /** 清单包含 `entry.js`（可执行）——界面据此显示「代码」标记。 */
  executable: z.boolean().default(false),
  dev: z.boolean().default(false),
  enabled: z.boolean().default(false),
  credentialStatus: PluginCredentialStatusSchema.default('none'),
  credentialMessage: z.string().nullable().default(null),
  actionUrl: z.string().nullable().default(null),
  inputs: z.array(PluginInputFieldSchema),
  inputValues: z.record(z.string(), z.string()),
  hasSecrets: z.array(z.string()).default([]),
  providerId: z.string().nullable().default(null),
  modelCount: z.number().int().nonnegative().default(0),
  lastSyncTime: z.number().int().nullable().default(null),
  lastSyncError: z.string().nullable().default(null),
})
export type PluginView = z.infer<typeof PluginViewSchema>

/** 安装来源。P0 只支持本地目录；`github` 已设计未实现（明确回 PLUGIN_SOURCE_UNSUPPORTED）。 */
export const PluginInstallSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('directory'), path: z.string().min(1) }),
  z.object({ type: z.literal('github'), repo: z.string().min(1), ref: z.string().optional(), subdirectory: z.string().optional() }),
])
export type PluginInstallSource = z.infer<typeof PluginInstallSourceSchema>

// ========== 宿主注入给 hook 的能力（类型，非运行时 schema） ==========

export interface PluginHttpRequest {
  method?: string
  url: string
  headers?: Record<string, string>
  body?: string
}

export interface PluginHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * hook 拿到的上下文。它**没有** `require` / `process` / 定时器 / 文件系统——
 * 唯一出站口是 `http`（经 core 的 `coreNetworkClient`，因此复用出站代理设置）。
 * 密钥命名空间限定为 `plugin::<key>::*`，插件看不到别的插件或别的 Provider 的密钥。
 */
export interface PluginContext {
  inputs: Record<string, string>
  secrets: {
    get(name: string): Promise<string | null>
    set(name: string, value: string): Promise<void>
    delete(name: string): Promise<void>
  }
  storage: {
    get(name: string): Promise<string | null>
    set(name: string, value: string): Promise<void>
  }
  http(request: PluginHttpRequest): Promise<PluginHttpResponse>
  log(level: 'log' | 'warn' | 'error', message: string): void
  now(): number
  request?: PluginRequestContext
}

/** `entry.js` 求值后应得的 hooks 对象。两个钩子都可选。 */
export interface PluginHooks {
  obtainCredential?(ctx: PluginContext): Promise<PluginCredentialResult>
  listModels?(ctx: PluginContext): Promise<PluginListModelsResult>
  resolveRequest?(ctx: PluginContext): Promise<PluginRequestResolutionResult>
}
