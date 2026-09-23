import { z } from 'zod'

import { LANGUAGE_PREFERENCES } from './i18n'

// ========== 枚举 ==========

export const ProtocolSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])
export type Protocol = z.infer<typeof ProtocolSchema>

/**
 * 渠道诊断要回答哪个问题。
 *
 * 三种模式问的是同一件事的不同侧面，所以它们是**互斥的一次运行**，不是三个页面：
 * - `connectivity`：这条链路通不通（等价于一次最小请求打穿到上游并拿到 2xx）；
 * - `streaming`：上游**真的**按 SSE 逐帧回吗——形态不符（回整包）在诊断里就是失败，
 *   而不是被悄悄当成「通」；
 * - `speed`：首字节等多久、出字多快。它必须走流式：整包响应里没有「首字节」这个时刻，
 *   出字速度也无从谈起。
 *
 * 词表放在 `@common` 的理由与 {@link TransportKindSchema} 相同：管理端与界面必须共用同一套，
 * 各写一份迟早漂移。
 */
export const ModelTestModeSchema = z.enum(['connectivity', 'streaming', 'speed'])
export type ModelTestMode = z.infer<typeof ModelTestModeSchema>
/** 界面要按固定顺序列出这三种模式；列表与枚举同源，避免两处各写一份顺序。 */
export const ALL_MODEL_TEST_MODES: ModelTestMode[] = [...ModelTestModeSchema.options]

/**
 * 传输：一次对话在线上长什么样。**全仓唯一的「形态」词。**
 *
 * 它把「用哪种连接」与「字节怎么回来」合成一句话说 —— 因为这两件事在协议上本来就是同一件
 * 事的两面，拆成两根轴之后必然要再造第三个词去描述它们的乘积：
 * - `http`：一问一答，响应体整包回来（非流式）；
 * - `http-stream`：一问一答，响应体逐帧回来（SSE）。两者在界面上就叫「非流式」与「流式」，
 *   不需要为它们再造另外的说法；与 `http` 在建连、TLS、超时、abort、
 *   出网方式上一字不差，差别只在响应体怎么分帧；
 * - `websocket`：双向多轮。
 *
 * **每「跳」各自一个传输。** 一次交换有两跳：
 * - 客户端跳由接口声明的请求写法读出（OpenAI 系请求体里的 `stream: true` 就是 `http-stream`）；
 * - 上游跳由端点**地址**与客户端跳的形态一起定下来（`wss://` 是 WebSocket；其余地址上我们
 *   忠实转发，发出去什么形态，上游就按什么形态回）。
 *
 * 因此读到 `transport` 要能立刻回答「哪一跳」。它也**不是**客户端偏好：上游用哪种连接形态由
 * 端点自己的地址决定，客户端说要 WebSocket 也改变不了一个 `https://` 端点的形态。
 *
 * 词表定义在这里（`@common`）而不是代理层，是因为**代理层与工作流层必须共用同一套**：
 * 两层各写一份「形态」枚举，迟早会出现「上层说有、下层不认」的漂移。
 *
 * `'websocket'` 是唯一**已声明、未实现**的取值：入口对 `Upgrade` 请求明确回 501，传输注册表
 * 对它明确抛错。保留它是因为「这个端点地址是 `wss://`，我们用不了」必须在类型上说得出来，
 * 退化成对地址字符串做正则只会让拒绝逻辑散到各处。
 */
export const TransportKindSchema = z.enum(['http', 'http-stream', 'websocket'])
export type TransportKind = z.infer<typeof TransportKindSchema>
/** 引擎认识的全部传输形态；枚举与列表同源，避免两处各写一份。 */
export const ALL_TRANSPORT_KINDS: TransportKind[] = [...TransportKindSchema.options]

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
  body: z.string(),
  headers: z.string(),
  clientProtocol: ProtocolSchema.default('openai-completions'),
  upstreamProtocol: ProtocolSchema.default('openai-completions'),
  /** 试跑时假设的传输形态；响应阶段的规则在 `http-stream` 下没有能做的事。 */
  transport: TransportKindSchema.default('http'),
})
export type RequestRewriteRuleTestCase = z.infer<typeof RequestRewriteRuleTestCaseSchema>
const RequestRewriteRuleActionBaseSchema = z.object({ stage: RuleStageSchema.default('request') })
export const RequestRewriteRuleActionSchema = z.discriminatedUnion('type', [
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-set'), name: z.string().min(1), value: z.string() }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-append'), name: z.string().min(1), value: z.string() }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-remove'), name: z.string().min(1) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-set'), path: z.string().min(3), value: JsonValueSchema }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-delete'), path: z.string().min(3) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-replace'), path: z.string().min(3), search: z.string(), replacement: z.string(), regex: z.boolean().default(false) }),
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

// 尝试的状态里没有 `pending`：尝试行在拿到结果之后才写入，
// 「还没有结果」由「没有这一行」唯一表达，枚举里再留一个待定值就是留一条不可达状态。
export const AttemptStatusSchema = z.enum(['success', 'failed', 'cancelled'])
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>

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
  /**
   * 这个协议在供应商这一层的默认地址。
   *
   * **空串表示「还没有默认地址」**，不是缺字段：模型先绑定了协议、用户还没在供应商上填地址时
   * 就是这种状态。它是协议的载体，不能被当成可用地址（路由、探测、模型列表都不认它）；
   * 模型自己也没写地址时保存会直接报 `ENDPOINT_URL_MISSING`，而不是存下一个打不出去的模型。
   */
  url: z.string().url().or(z.literal('')),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable().default(null),
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
  deletedTime: z.number().int().nullable().default(null),
})
export type ProviderModelEndpoint = z.infer<typeof ProviderModelEndpointSchema>

export const ProtocolConverterSchema = z.object({
  id: z.string(),
  providerModelEndpointId: z.string(),
  clientProtocol: ProtocolSchema,
  enabled: z.boolean().default(false),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable().default(null),
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
  deletedTime: z.number().int().nullable().default(null),
})
export type SchedulingPolicy = z.infer<typeof SchedulingPolicySchema>

// ========== Logical Model ==========

/** Logical model IDs are stable public model identifiers. */
export const LogicalModelIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'logical model id must start with a lowercase letter and may only contain lowercase letters, digits, underscores and hyphens (max 64 characters)')

/**
 * 内建默认逻辑模型的名字：启动时由 `ensureDefaultLogicalModel` 建出来（id 与 name 都取这个值）。
 *
 * 它是内建「模型直达」规则的回落落点——请求模型没命中任何已启用逻辑模型时落到这里。
 * 服务端的回落匹配、启动时的种子写入、以及路由工作台里默认策略的落点都引用同一个常量，
 * 不再各自重复写这个字面量。
 */
export const BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME = 'default'

/**
 * 内建默认逻辑模型的种子说明。
 *
 * 它是服务端写入的初始值，不是用户输入——因此在界面上要能被翻译：前端看到说明恰好等于这个
 * 常量时，就换成目录里的本地化文案（用户改过的说明不受影响，照旧显示服务端值）。
 */
export const BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION = 'Default fallback routing model'

/** 只用到 id 与 name 的模型描述，避免让谓词依赖完整的 `LogicalModel`。 */
export interface LogicalModelIdentity {
  id: string
  name: string
}

/**
 * 是否是内建默认逻辑模型。
 *
 * 种子写入时 id 与 name 都是 `default`，但历史数据或手改过的记录可能只对上其中一个，
 * 所以两个都比对一次——请求模型命中的判断也是 id 与 name 都看的，两边保持一致。
 */
export function isBuiltInDefaultLogicalModel(model: LogicalModelIdentity): boolean {
  return model.id === BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME || model.name === BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME
}

export const LogicalModelSchema = z.object({
  id: LogicalModelIdSchema,
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

/**
 * 逻辑模型页的条目：在 `ProviderModelRoute` 之上多带一个「模型本体开关」。
 *
 * 这里的 `enabled` 是**这个逻辑模型里的绑定开关**（`scheduling_policies.enabled`），
 * `modelEnabled` 才是供应商那边的模型本体开关（`provider_models.enabled`）。
 *
 * 两个开关必须分开：`getAvailableModels` 要求模型本体也是启用的，所以一个被全局停用的模型
 * 无论绑定怎么摆都不会被调度。只回一个 `enabled` 时，界面只能把「停用」画成「待命」，
 * 用户看到的是「看着开着、却永远不参与调度」。
 */
export const LogicalModelProviderModelSchema = ProviderModelRouteSchema.extend({
  modelEnabled: z.boolean(),
})
export type LogicalModelProviderModel = z.infer<typeof LogicalModelProviderModelSchema>

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

/**
 * 界面语言：`system` 表示跟随操作系统。
 *
 * 取值来自 `@common/i18n` 的 `LANGUAGE_PREFERENCES`，不在这里另写一份枚举——
 * 语言列表是 i18n 核心的概念，两处各写一份迟早会漂移。
 */
export const LanguagePreferenceSchema = z.enum(LANGUAGE_PREFERENCES)
export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>

/**
 * 智能路由的生效模式：工作流编排（`workflow`）或路由规则（`rules`）。
 *
 * 两种模式各自是一份独立的真相（各自的定义、各自的版本列表、各自的编辑器），
 * 因此「哪一份生效」本身就是必须持久化、必须只有一个的事实——
 * 它放在设置里而不是某一份定义上：谁的编辑都不能顺手把自己提成生效模式。
 * 由它单点决定代理执行哪一份，另一个模式的定义只是暂时不生效，不会被删。
 */
export const RouteModeSchema = z.enum(['workflow', 'rules'])
export type RouteMode = z.infer<typeof RouteModeSchema>

export const SettingsSchema = z.object({
  id: z.literal('singleton'),
  listenHost: z.string().default('127.0.0.1'),
  listenPort: z.number().int().min(1).max(65535).default(9300),
  /**
   * 是否记录请求日志（请求身份、逐次尝试、用量与指标）。
   *
   * 关掉之后新请求只走代理链路、不落库；正文记录随之失效——没有请求行，正文行无处归属。
   */
  captureRequestLogs: z.boolean().default(true),
  /**
   * 请求日志的自动保留天数。`0` 表示永久保留（默认）。
   *
   * 只删除「请求」这一层：请求行、尝试行、用量行一起走，正文也一起走。
   * 想看逐次尝试的用量与指标但不想留正文时，请用 {@link contentRetentionDays} 而不是这里。
   */
  requestLogRetentionDays: z.number().int().nonnegative().default(0),
  /**
   * 是否记录请求与响应正文（请求头/体、响应头/体，客户端与上游两个视角）。
   *
   * 正文是日志里唯一会随请求长度线性膨胀的部分，因此单独一个开关。
   */
  captureRequestContent: z.boolean().default(true),
  /**
   * 请求与响应正文的自动保留天数。`0` 表示永久保留；默认 7 天。
   *
   * 正文体积远大于指标，过期的正文没有留存价值：过期只删正文行（含转换前后两个视角），
   * 请求行、尝试行与用量/指标全部保留，历史统计不会因此失真。
   */
  contentRetentionDays: z.number().int().nonnegative().default(7),
  cooldownBaseSeconds: z.number().int().positive().default(30),
  cooldownMaxSeconds: z.number().int().positive().default(300),
  consecutiveFailureThreshold: z.number().int().positive().default(3),
  idleTimeoutMilliseconds: z.number().int().positive().default(30000),
  outboundProxyMode: OutboundProxyModeSchema.default('system'),
  outboundProxyUrl: z.string().default(''),
  outboundProxyBypass: z.string().default('localhost,127.0.0.1,::1'),
  autoLaunch: z.boolean().default(false),
  /**
   * 界面语言偏好。
   *
   * 放在服务端设置里而不是渲染进程的 `localStorage`：托盘菜单与原生对话框由主进程渲染，
   * 主进程读不到渲染进程的存储（见 `docs/product/i18n.md` §3）。
   */
  language: LanguagePreferenceSchema.default('system'),
  /**
   * 生效的智能路由模式。
   *
   * 默认是工作流编排：它是这个功能最早的样子，升级到新版本时不该有人发现自己的路由静默换了实现。
   * 切到规则模式后，图仍然完整保留（在它的版本列表里），切回来就恢复。
   */
  routeMode: RouteModeSchema.default('workflow'),
  /**
   * 匿名使用统计的开关。**默认开启**——它用来判断功能是否真的被用起来，是产品的既定行为；
   * 界面上不提供任何入口，设置页也不做任何展示（见 `docs/product/telemetry.md` §13）。
   *
   * 字段本身仍然保留：它是「采集是否被允许」的唯一判据（开发档另有一条独立短路）。
   * 关掉后不再采集任何事件，队列里压着的那一批会尽力发完，但**没有**一条「开关被改了」的事件——
   * 早先有过 `telemetry_toggled`，已撤掉（没有开关就触发不到）。代价与取舍见 telemetry.md §13。
   *
   * 采集范围、事件白名单与保留期都在 telemetry.md，不在这里复述。
   */
  telemetryEnabled: z.boolean().default(true),
  /**
   * 上报端点的覆盖值，**空字符串表示用内置常量**（`@common/telemetry` 的 `TELEMETRY_ENDPOINT`）。
   *
   * 只给开发档使用：把请求打到本地的 `wrangler dev` 上，不必改代码也不必发版。
   * 它不做校验、不会被用户改到别处去——它不是「自定义上报服务」功能，
   * 只是一个让本地调试不必污染生产数据的出口。
   */
  telemetryEndpoint: z.string().default(''),
  updatedTime: z.number().int(),
})
export type Settings = z.infer<typeof SettingsSchema>

// ========== Request Log ==========

export const RawUsageSchema = z.record(z.unknown())
export type RawUsage = z.infer<typeof RawUsageSchema>

export const RequestLogSchema = z.object({
  id: z.string().startsWith('req_'),
  /** 为 `null` 表示请求在解析出逻辑模型之前就已经失败。 */
  logicalModelId: z.string().nullable(),
  /** 为 `null` 表示请求连 API 路径都无法识别，不存在「客户端协议」这个事实。 */
  clientProtocol: ProtocolSchema.nullable(),
  /**
   * 客户端跳的传输形态。**这是预期**，解析完请求体即可确定，与上游实际怎么回的无关。
   *
   * 保留轴上的取值而不是布尔列：`http` 与 `http-stream` 是这一根轴上的两档，
   * 「上游实际按哪一档作答」落在 {@link RequestAttemptSchema} 的 `upstreamTransport`。
   */
  transport: TransportKindSchema,
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  /**
   * 用量字段都是**派生视图**，不是存储列。
   *
   * 请求级用量（含原始 usage 报文）由 `request_usages` 唯一持有，原始报文是其中
   * `type = 'raw'` 的行；`totalTokens` 则是 `inputTokens + outputTokens` 的派生值，
   * 不单独落库，避免出现「上游给了 total 但和两个分量对不上」的第三份数字。
   */
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().nullable(),
  /** 派生值：请求级 `cachedInputTokens > 0`。缓存是否命中不是独立事实。 */
  promptCacheHit: z.boolean().nullable(),
  rawUsage: RawUsageSchema.nullable(),
  /**
   * 请求级派生值：取**服务该请求的那次尝试**（尝试顺序里的最后一条）的
   * `request_attempts.ttftMilliseconds`，不是存储列。
   *
   * 不能取历次尝试的最小值：被放弃的尝试从没向客户端写出过一个字节，
   * 它的首字延迟不是「客户端多久看到第一个 token」。
   */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  createdTime: z.number().int(),
})
export type RequestLog = z.infer<typeof RequestLogSchema>
/**
 * 请求日志的可更新字段。
 *
 * 只剩「请求级结果」这一类事实：状态与总耗时。以下字段刻意不可写：
 * `ttftMilliseconds` 是尝试级事实的视图；用量（含原始 usage 报文）由
 * `request_usages` 唯一持有，写入点是「服务该请求的那次尝试」的落库事务。
 * 允许在这里再写一遍，就是制造一份会与尝试级数据漂移的副本。
 */
export type RequestLogUpdate = Partial<Pick<RequestLog, 'status' | 'totalDurationMilliseconds'>>

export const RequestAttributeSchema = z.object({
  requestId: z.string().startsWith('req_'),
  key: z.string().min(1).max(128),
  /** 属性值一律是字符串：采集侧只产出字符串，因此不另设「值类型」维度。 */
  value: z.string().max(4096),
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
  /** 实际发往上游的协议。与请求的 `clientProtocol` 不同即代表发生过协议转换。 */
  upstreamProtocol: ProtocolSchema.nullable(),
  upstreamRequestId: z.string().nullable(),
  url: z.string(),
  attemptIndex: z.number().int().nonnegative(),
  status: AttemptStatusSchema,
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  /**
   * 上游本次尝试实际按哪一档形态作答。
   *
   * 这是**上游视角**的事实。「客户端跳的形态」是请求级事实，落在 `request_logs.transport`，
   * 两者是不同的东西，不能互相顶替；两者不一致（要 `http-stream` 却回了整包）就是上游违约，
   * 在代码里表现为这次尝试被判 failover（§1.2）。
   * 未收到响应（网络错误、请求取消）时无从判断，因此为 `null`。
   */
  upstreamTransport: TransportKindSchema.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时为 null。 */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  /** 该次尝试在请求阶段命中的改写规则 id。 */
  requestRewriteRuleIds: z.array(z.string()).default([]),
  /** 该次尝试在响应阶段命中的改写规则 id。 */
  responseRewriteRuleIds: z.array(z.string()).default([]),
  createdTime: z.number().int(),
})
export type RequestAttempt = z.infer<typeof RequestAttemptSchema>

// 正文采集的状态。只有「采到了」和「只采到一部分」两种真实情况：
// 采集被设置关闭时根本不会写入正文行，因此“没有行 = 未采集”由行是否
// 存在唯一确定，不需要用枚举值再表达一次。
// captured — 完整采集
// partial  — 只采集到部分内容（流式中断、上游报错、请求未走完）
export const RequestContentCaptureStatusSchema = z.enum(['captured', 'partial'])
export type RequestContentCaptureStatus = z.infer<typeof RequestContentCaptureStatusSchema>

// 正文模型按「视角」正交拆分，每张表只承载一个视角，因此列名一律使用裸名
// （headers / body / status）而不再带 client / upstream 前缀——视角由表名
// 唯一确定，不存在二义。
//
//   request_contents   客户端视角（每个请求一行）
//   attempt_contents   上游视角  （每次尝试一行）
//
// 「发生过协议转换」这个事实不单独建表：它由
// `request_attempts.upstreamProtocol` 与请求的 `clientProtocol` 是否相同
// 唯一确定，单独存一份必然会漂移。
// 形态则按视角拆成两个事实：客户端跳声明的形态落在 `request_logs.transport`，
// 上游跳实际是什么形态落在 `request_attempts.upstreamTransport`。

/**
 * 客户端视角的正文记录：客户端原始请求 + 最终回给客户端的响应。
 * 每个请求恰好一行（`requestId` 唯一）。
 */
export const RequestContentSchema = z.object({
  id: z.string().startsWith('content_'),
  requestId: z.string().startsWith('req_'),
  captureStatus: RequestContentCaptureStatusSchema,
  /** 客户端使用的 HTTP 方法。 */
  requestMethod: z.string(),
  /** 客户端请求的路径。 */
  requestPath: z.string(),
  /** 客户端原始请求头（脱敏后的 JSON 字符串）。 */
  requestHeaders: z.string().nullable(),
  /** 客户端原始请求体。完整保存，一字不差。 */
  requestBody: z.string().nullable(),
  /** 最终返回给客户端的 HTTP 状态码。 */
  responseStatus: z.number().int().nullable(),
  /** 最终返回给客户端的响应头（脱敏后的 JSON 字符串）。 */
  responseHeaders: z.string().nullable(),
  /** 最终返回给客户端的响应体。完整保存，一字不差。 */
  responseBody: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type RequestContent = z.infer<typeof RequestContentSchema>

/**
 * 上游视角的正文记录：真正发往上游的请求 + 上游返回的响应。
 * 每次尝试恰好一行（`attemptId` 唯一）。
 *
 * 归属的请求、命中的改写规则这些事实都由 `request_attempts` 持有，
 * 这里只保存上游视角的报文本身。
 */
export const AttemptContentSchema = z.object({
  id: z.string().startsWith('attempt_content_'),
  attemptId: z.string().startsWith('att_'),
  captureStatus: RequestContentCaptureStatusSchema,
  /** 发往上游的请求头（脱敏后的 JSON 字符串），含改写与协议转换的结果。 */
  requestHeaders: z.string().nullable(),
  /** 发往上游的请求体，含改写与协议转换的结果。完整保存，一字不差。 */
  requestBody: z.string().nullable(),
  /** 上游返回的 HTTP 状态码。 */
  responseStatus: z.number().int().nullable(),
  /** 上游返回的响应头（脱敏后的 JSON 字符串）。 */
  responseHeaders: z.string().nullable(),
  /** 上游返回的响应体。完整保存，一字不差。 */
  responseBody: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type AttemptContent = z.infer<typeof AttemptContentSchema>

// 正文是库里唯一随请求长度线性膨胀的部分（单条可达上 MB），而详情在请求还是
// `pending` 时每 1.5s 就会重取一次。把正文塞在详情里，等于让轮询反复解压最大的
// 那两列（见 issue #23）。因此详情只带**摘要**：说清这次请求/这次尝试有哪些报文
// （方法、路径、状态、头），正文本身由用户在界面上点开正文面板时另行获取。
//
// 摘要不是另一份数据，就是同一行的投影：截到这里只是为了「详情不带正文」这一条
// 契约，字段本身仍以 `RequestContent` / `AttemptContent` 为唯一来源。
export const RequestContentSummarySchema = RequestContentSchema.omit({ requestBody: true, responseBody: true })
export type RequestContentSummary = z.infer<typeof RequestContentSummarySchema>

export const AttemptContentSummarySchema = AttemptContentSchema.omit({ requestBody: true, responseBody: true })
export type AttemptContentSummary = z.infer<typeof AttemptContentSummarySchema>

/** 按需取回的正文。粒度是整个请求：界面一次要看的几个视角一并返回，不来回请求。 */
export const RequestLogBodiesSchema = z.object({
  /** 客户端视角，每个请求至多一行。 */
  contents: z.array(RequestContentSchema),
  /** 上游视角，每次尝试至多一行。 */
  attemptContents: z.array(AttemptContentSchema),
})
export type RequestLogBodies = z.infer<typeof RequestLogBodiesSchema>

// ========== 进行中的请求（内存态，不落库） ==========
//
// 与 `RequestLogEntry` 的关系：日志行是**落库的结论**，一个请求只有等它结束才写完整；
// 这一组描述的是**还没结束的那个请求现在是什么样**。因此它只存在于代理进程的内存里，
// 请求一落定就被丢弃，不参与保留期、不进导出、也不进统计——那些口径一律以数据库为准。
//
// 唯一的用途是让界面在请求进行中就能看见：路由到了谁、数据流到哪一步、当前状态如何。

/**
 * 一次请求当前走到了哪一步。与 `status` 是两个维度：`status` 说结局，阶段说过程。
 *
 * 阶段划到什么粒度是**照着可观测的事实**定的，不是照着一厢情愿的流程图：凡是代理进程
 * 拿不到打点的地方就不立阶段（例如「请求体正在写往 socket」在现有传输层里没有回调，
 * 因此没有 `sending`）。反过来，`awaiting-upstream` 与 `awaiting-first-byte` 一定要分开——
 * 上游回了 `200` 却迟迟不吐字，和上游根本还没回头，是两种完全不同的卡法，
 * 界面上合成一句「等上游」就没法归因了。
 */
export const LiveRequestPhaseSchema = z.enum([
  /** 正在识别接口、求解路由、规划候选。 */
  'routing',
  /** 候选已选定，正在建立上游连接、准备这次尝试要发出去的请求。 */
  'connecting',
  /** 请求已发出，等上游返回响应头。 */
  'awaiting-upstream',
  /** 上游已经回头（响应头到了），但正文的第一个字节还没来。 */
  'awaiting-first-byte',
  /** 正文来了，正在把字节交给客户端。 */
  'streaming',
  /** 已出结果，等待从内存里移除。 */
  'settled',
])
export type LiveRequestPhase = z.infer<typeof LiveRequestPhaseSchema>

/**
 * 一次尝试此刻走到了哪一步。
 *
 * 与落库的尝试行不同，这里没有 `pending`：尝试行是在真正要连上游的那一刻才被创建的
 * （见 `LiveRequestStore.startAttempt`），因此它的起点是 `connecting`，不存在「已排队」。
 */
export const LiveRequestAttemptStateSchema = z.enum(['connecting', 'awaiting-upstream', 'streaming', 'success', 'failed', 'cancelled'])
export type LiveRequestAttemptState = z.infer<typeof LiveRequestAttemptStateSchema>

export const LiveRequestEventLevelSchema = z.enum(['info', 'success', 'warn', 'error'])
export type LiveRequestEventLevel = z.infer<typeof LiveRequestEventLevelSchema>

/**
 * 时间线上的一条事件。
 *
 * 「谁在什么时候发生了什么」在这里是**追加写**的：一次请求的事件序列只会变长，已经写下的
 * 条目不会被改写（只会从头部裁掉最旧的几条）。界面每次轮询拿到的是整份快照，但因为是
 * 追加写，「同一条事件前后两次读到不一样的文字」不会发生。
 */
export const LiveRequestEventSchema = z.object({
  /** 事件发生时刻（epoch ms）。 */
  at: z.number().int(),
  /** 相对请求开始的毫秒偏移；界面直接用它排时间轴。 */
  offsetMilliseconds: z.number().int().nonnegative(),
  /** 机器可读的事件类型（如 `route.resolved`、`upstream.head`）。 */
  kind: z.string(),
  level: LiveRequestEventLevelSchema,
  /** 补充事实，供界面按事件类型取值插值。 */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
})
export type LiveRequestEvent = z.infer<typeof LiveRequestEventSchema>

/** 进行中的一次尝试。字段是落库尝试行的子集，只保留「此刻能看见」的那些。 */
export const LiveRequestAttemptSchema = z.object({
  index: z.number().int().nonnegative(),
  providerId: z.string(),
  providerName: z.string(),
  providerModelId: z.string(),
  providerModelName: z.string(),
  endpointProtocol: ProtocolSchema,
  url: z.string(),
  state: LiveRequestAttemptStateSchema,
  httpStatus: z.number().int().nullable(),
  upstreamTransport: TransportKindSchema.nullable(),
  /** 发往上游的请求体字节数。 */
  requestBytes: z.number().int().nonnegative(),
  /**
   * 本次尝试命中的请求改写规则**名字**（按命中顺序，可能为空数组）；读不到名字时回落成 id。
   *
   * 落库那条路径存的是 id，界面拿 id 回来查名字（见 `AppliedRequestRewriteRule`）；
   * 实时侧没有那份字典，而这一格要回答的是「刚才哪个修改器动过这个请求」——
   * 名字是人写的、也是人读的，所以这里直接带名字。
   */
  requestRewriteRuleNames: z.array(z.string()),
  /** 从上游收到的字节数。 */
  upstreamBytes: z.number().int().nonnegative(),
  /** 实际写给客户端的字节数（可能是转换产物）。 */
  downstreamBytes: z.number().int().nonnegative(),
  /** 上游分块数。整包响应为 `1`。 */
  chunkCount: z.number().int().nonnegative(),
  /**
   * **最近一个**上游分块开头的预览，**原文照抄、不解析**；还没有分块时为 `null`。
   *
   * 只留最新的一条是刻意的：这里要回答的是「上游此刻在回什么」（正常 SSE、报错页、
   * 一串二进制），不是「这一路都回了些什么」——后者属于正文，正文只在落库那边按需取回。
   * 保留一串历史分块既不会让判断更准，又要求界面处理「列表在跳动」，还要在内存里多存一份正文。
   *
   * 长度上限由台账给定（前 80 个字符，超出部分以 `…` 收尾），所以它永远只是开头那一段，
   * 不是正文的副本。不参与任何统计与落库。
   */
  chunkPreview: z.string().nullable(),
  /** 首字节时延；还没出内容时为 `null`。 */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  /**
   * 进行中读到的用量；上游还没报时为 `null`。
   *
   * 输入侧上游通常在第一个事件就报完，输出侧则是一路累加，所以两个字段都可能比最终值小。
   * 它们只用来让「正在进行」的行也有数字可看，落库后一律以 `RequestLogEntry` 为准。
   */
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /**
   * 与落库尝试行同名的字段；实时侧目前只写 `errorMessage`，因此读它只会得到 `null`。
   * 界面不要依赖它——错误码需要等执行器把失败原因（`conclusion`）也补进来才有。
   */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
})
export type LiveRequestAttempt = z.infer<typeof LiveRequestAttemptSchema>

/** 规划出的一个候选；顺序即优先级。 */
export const LiveRequestCandidateSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  providerModelId: z.string(),
  providerModelName: z.string(),
})
export type LiveRequestCandidate = z.infer<typeof LiveRequestCandidateSchema>

/** 一次进行中的请求此刻的完整快照。 */
export const LiveRequestSchema = z.object({
  id: z.string().startsWith('req_'),
  /** 请求级结局；进行中恒为 `pending`。 */
  status: RequestStatusSchema,
  phase: LiveRequestPhaseSchema,
  logicalModelId: z.string().nullable(),
  clientProtocol: ProtocolSchema.nullable(),
  transport: TransportKindSchema,
  method: z.string(),
  path: z.string(),
  startedAt: z.number().int(),
  /** 最近一次写入的时刻（请求级）；`LiveRequestStore.prune` 用它做保留期兼底。 */
  updatedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
  /** 尚未规划时为 `[]`，不是「没有候选」。 */
  candidates: z.array(LiveRequestCandidateSchema),
  attempts: z.array(LiveRequestAttemptSchema),
  events: z.array(LiveRequestEventSchema),
})
export type LiveRequest = z.infer<typeof LiveRequestSchema>

/**
 * 一次「进行中的请求」的全量快照。
 *
 * 这个形状有两处用途，且刻意共用同一份定义：拉取式（`POST /api/request-log/live` 一次性返回）
 * 与推送式（`POST /api/request-log/live/stream` 按行推 NDJSON）——推送流里的每一行就是一份
 * 新的完整快照。共用形状意味着界面只有一套解析路径，也意味着「拉一次」和「订阅一段」
 * 拿到的东西不会漂移。
 *
 * 同理，这里**不做增量**：进行中的请求是有限的一小撮（进行中的 + 刚结束的若干条），
 * 全量重发比重放增量更不容易出错，而增量协议必须自己承担乱序、丢帧与重连后的对齐问题。
 */
export const LiveRequestSnapshotSchema = z.object({
  requests: z.array(LiveRequestSchema),
})
export type LiveRequestSnapshot = z.infer<typeof LiveRequestSnapshotSchema>

// ========== API 响应结构 ==========

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  errorCode: z.string(),
  /** 诊断消息，固定英文。界面**不要**直接展示它，按 `errorCode` 本地化（见 `docs/product/i18n.md` §5）。 */
  errorMessage: z.string(),
  /**
   * 消息里 `{name}` 占位符的取值。
   *
   * 服务端只说事实（「供应商不存在：prov_x」），不拼给人看的句子；界面按错误码取模板后再插值。
   * 只在模板需要插值时出现，避免把上原文塞进响应体。
   */
  errorParams: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([ApiSuccessSchema(dataSchema), ApiErrorSchema])

export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = {
  success: false
  errorCode: string
  errorMessage: string
  errorParams?: Record<string, string | number>
}
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
  'INVALID_JSON',
  'METHOD_NOT_ALLOWED',
  // 资源
  'RESOURCE_NOT_FOUND',
  'DUPLICATE_RESOURCE',
  'RESOURCE_CONFLICT',
  // 供应商/模型端点配置：保存与探测时就能判定，不必等到发出请求
  'ENDPOINT_URL_MISSING',
  'ENDPOINT_URL_IN_USE',
  'PROVIDER_MODEL_DISABLED',
  // 存储
  'DATABASE_UNAVAILABLE',
  'SECRET_STORE_UNAVAILABLE',
  // 代理
  'UNKNOWN_API_PATH',
  'UPSTREAM_ERROR',
  'UPSTREAM_STREAM_ERROR',
  'ALL_PROVIDERS_FAILED',
  'NO_AVAILABLE_PROVIDER',
  'PROXY_NOT_RUNNING',
  'NO_MODEL_CONFIGURED',
  'INVALID_MODEL',
  'MANUAL_MODEL_UNAVAILABLE',
  'REQUEST_REWRITE_RULE_FAILED',
  'PROXY_INTERNAL_ERROR',
  'SYSTEM_PROXY_RESOLUTION_FAILED',
  'OUTBOUND_PROXY_UNREACHABLE',
  'OUTBOUND_PROXY_AUTH_REQUIRED',
  'OUTBOUND_PROXY_TUNNEL_REJECTED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_AUTH_FAILED',
  'UPSTREAM_MODELS_UNAVAILABLE',
  'CLIENT_REQUEST_ABORTED',
  'TRANSPORT_NOT_IMPLEMENTED',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// ========== 请求日志条目（含 attempt + providerName，用于列表展示） ==========

export const RequestLogEntryAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  attemptIndex: z.number().int().nonnegative(),
  status: AttemptStatusSchema,
  providerId: z.string(),
  providerName: z.string(),
  providerModelId: z.string(),
  providerModelName: z.string(),
  upstreamProtocol: ProtocolSchema.nullable(),
  upstreamRequestId: z.string().nullable(),
  url: z.string(),
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  /** 上游跳实际是什么形态；未收到响应时为 `null`。 */
  upstreamTransport: TransportKindSchema.nullable(),
  /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时为 null。 */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  /** 该次尝试在请求阶段命中的改写规则 id。 */
  requestRewriteRuleIds: z.array(z.string()),
  /** 该次尝试在响应阶段命中的改写规则 id。 */
  responseRewriteRuleIds: z.array(z.string()),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestLogEntryAttempt = z.infer<typeof RequestLogEntryAttemptSchema>

export const RequestLogEntrySchema = z.object({
  id: z.string().startsWith('req_'),
  /** 为 `null` 表示请求在解析出逻辑模型之前就已经失败。 */
  logicalModelId: z.string().nullable(),
  /** 为 `null` 表示请求连 API 路径都无法识别。 */
  clientProtocol: ProtocolSchema.nullable(),
  /** 客户端跳声明的形态（预期）；与尝试行的 `upstreamTransport` 是两个事实。 */
  transport: TransportKindSchema,
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
  /** 只有摘要，正文按需另取（`RequestLogBodies`）。 */
  contents: z.array(RequestContentSummarySchema),
  attemptContents: z.array(AttemptContentSummarySchema),
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
  /**
   * 输入 Token 总量，含缓存读取——缓存只是计费便宜，上下文该读进去的字节一个不少。
   *
   * 与 `outputTokens` 一起由同一次扫描选出，供用量结构的派生值使用。
   */
  inputTokens: z.number().int().nonnegative(),
  /**
   * 输出 Token 总量。与 `inputTokens` 一起构成「Token 消耗」的加数。
   */
  outputTokens: z.number().int().nonnegative(),
  /** 输入 + 输出，派生值；卡片上的「Token 消耗」。 */
  totalTokens: z.number().int().nonnegative(),
  /**
   * 缓存命中率：缓存读取 Token ÷ `inputTokens`（后者本就含缓存读取）。
   *
   * 窗口内输入为 0 时为 `null`：没测到不是命中率为零。口径见 `@common/metrics` 的 `cacheHitRate`。
   */
  cacheHitRate: z.number().min(0).max(1).nullable(),
})
export type StatsSummary = z.infer<typeof StatsSummarySchema>

/**
 * 用量趋势里的一个桶。
 *
 * `label` 是**桶的起点**（不是结束时间），写法由粒度决定：不足一天是
 * `YYYY-MM-DD HH:MM`，一天及以上只写 `YYYY-MM-DD`（见 `@common/analytics-buckets`）。
 * 同一趋势里的桶宽恒定，空桶也要出现在数组里——图表靠空桶保持时间轴连续。
 */
export const UsageTrendPointSchema = z.object({
  label: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
})
export type UsageTrendPoint = z.infer<typeof UsageTrendPointSchema>

/** 趋势图每一根柱子覆盖的毫秒数：由查询范围推导，界面据此决定坐标轴刻度怎么写。 */
export const TrendIntervalSchema = z.number().int().positive()

export const ProviderStatSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  /** 调用次数（每次上游尝试计一次，与请求数不同）。 */
  attempts: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /**
   * 缓存命中率：该提供方**成功尝试**的缓存读取 Token ÷ 输入 Token 总量。
   *
   * 与模型表同一口径（分子分母都只取成功的尝试）。没有输入 Token 时为 `null`，
   * 界面写 `—`：没测到不是命中率为零。
   */
  cacheHitRate: z.number().min(0).max(1).nullable(),
  percent: z.number().int().min(0).max(100),
})
export type ProviderStat = z.infer<typeof ProviderStatSchema>

export const ModelStatSchema = z.object({
  providerModelId: z.string(),
  providerModelName: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  /** 调用次数（每次上游尝试计一次，与请求数不同）。 */
  attempts: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgTtftMs: z.number().nonnegative().nullable(),
  avgTps: z.number().nonnegative().nullable(),
  /**
   * 平均输出 Token：该模型成功调用的输出总量 ÷ 成功调用数。
   *
   * 分子只含成功调用的输出（见 `analytics-store` 的 `successOnly`），分母就必须是成功调用数——
   * 拿它去除以全部调用会让比值被单方面压低。没有成功调用时为 `null`。
   */
  avgOutputTokens: z.number().nonnegative().nullable(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
  /**
   * 窗口内该模型**成功尝试**的用量合计，与上面几个派生值同源。
   *
   * 保留原始合计而不只给平均值，是因为账单要把跨供应商的同名模型合并成一行：
   * 合计只能相加，平均与比率都得用合计重新算一遍，拿平均值去加权会得到
   * 「按模型数量平均」的假命中率。三个字段一一对应 `cachedInputTokens ⊆ inputTokens`，
   * 合并方不得自行推导其中一个。
   */
  outputTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
})
export type ModelStat = z.infer<typeof ModelStatSchema>

export const LatencyBucketSchema = z.object({
  range: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type LatencyBucket = z.infer<typeof LatencyBucketSchema>

/**
 * 失败原因的分类码。
 *
 * 只作为**机器码**存在：服务端只负责把上游错误归到某几个桶里，桶名本身不携带语言，
 * 界面按当前语言把码翻成人看的标签。把标签存进库里，等于让界面语言成为数据库口径的一部分。
 */
export const FAILURE_REASON_CATEGORIES = ['TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR', 'AUTH_FAILED', 'OTHER'] as const
export const FailureReasonCategorySchema = z.enum(FAILURE_REASON_CATEGORIES)
export type FailureReasonCategory = z.infer<typeof FailureReasonCategorySchema>

export const FailureReasonStatSchema = z.object({
  reason: FailureReasonCategorySchema,
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

export const ProviderRequestTrendPointSchema = z.object({
  label: z.string(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
})
export type ProviderRequestTrendPoint = z.infer<typeof ProviderRequestTrendPointSchema>

export const ProviderDetailSummarySchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  /** 调用次数（每次上游尝试计一次，与请求数不同）。 */
  attempts: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  cacheHitRate: z.number().min(0).max(1).nullable(),
  totalTokens: z.number().int().nonnegative(),
})
export type ProviderDetailSummary = z.infer<typeof ProviderDetailSummarySchema>

export const ProviderAnalyticsDetailSchema = z.object({
  summary: ProviderDetailSummarySchema,
  trendIntervalMs: TrendIntervalSchema,
  requestTrend: z.array(ProviderRequestTrendPointSchema),
  tokenTrend: z.array(UsageTrendPointSchema),
  models: z.array(ModelStatSchema),
  latencyDistribution: z.array(LatencyBucketSchema),
  failureReasons: z.array(FailureReasonStatSchema),
})
export type ProviderAnalyticsDetail = z.infer<typeof ProviderAnalyticsDetailSchema>

/**
 * 用量分布热力图的一格：一个热力桶的请求数。
 *
 * `label` 沿用时间桶的写法（见 {@link UsageTrendPoint}），界面因此可以直接复用趋势图那套
 * tooltip 标题格式化，不必再定义一份时间写法。格宽不在这里重复回传：它是
 * `AnalyticsSummary.heatIntervalMs`——热力格比趋势柱细，两者不是一个数。
 *
 * 热力深浅按 `requests` 算（贡献图数的也是「次数」而不是「体积」），token 用量退到 tooltip 里。
 */
export const UsageHeatBucketSchema = z.object({
  label: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
export type UsageHeatBucket = z.infer<typeof UsageHeatBucketSchema>

export const AnalyticsSummarySchema = z.object({
  summary: StatsSummarySchema,
  /** 趋势桶宽，趋势图按它写坐标轴。 */
  trendIntervalMs: TrendIntervalSchema,
  /** 热力格宽，用量分布按它写标题。 */
  heatIntervalMs: TrendIntervalSchema,
  heat: z.array(UsageHeatBucketSchema),
  trend: z.array(UsageTrendPointSchema),
  providerStats: z.array(ProviderStatSchema),
  modelStats: z.array(ModelStatSchema),
  latencyDistribution: z.array(LatencyBucketSchema),
  failureReasons: z.array(FailureReasonStatSchema),
  sourceStats: z.array(RequestSourceStatSchema),
})
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>
