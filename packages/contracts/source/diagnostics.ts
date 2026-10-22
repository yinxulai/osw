import { z } from 'zod'

import type { TranslateParams } from './i18n/types'
import { ModelTestModeSchema, ProtocolSchema, type ModelTestMode, type Protocol } from './schemas'

/**
 * 渠道诊断的线上契约：**两端共用这一份**，服务端产出、界面消费。
 *
 * 为什么住在契约层而不是服务端路由里：这套形状原先被抄了三份——服务端
 * `routes/diagnostics/model-test.ts` 一份、界面 `api/tools.ts` 一份、连接测试
 * `model-connectivity.ts` 一份，字段名与可空性各写各的。三份里任意两份漂移都不会
 * 有任何构建或测试报警，只会表现为「界面上那一格永远是 —」这种行为级故障。
 *
 * 词表的归属也在这里划清：**模式词表（{@link ModelTestMode}）留在 `schemas.ts`**，
 * 因为那一层同时被服务端校验、界面渲染与 i18n 目录引用，是比诊断结果更底层的词；
 * 本文件只在它的基础上描述「一次诊断要发什么、会回什么」。
 */

/**
 * 轮次下界。
 *
 * 这是**定义**不是策略：诊断至少要问一次上游，零轮不是一个有意义的请求。
 * 上界刻意不给——多跑几轮花的是用户自己的钱、等的是用户自己的时间，
 * 替他判断「测到多少算够」没有依据（见 `apps/docs/specs/operations/diagnostics.md` §5）。
 */
export const MIN_MODEL_TEST_ROUNDS = 1

/**
 * 渠道诊断的请求体。
 *
 * `default()` 是**契约的一部分**，不是服务端的宽容：老界面、老脚本发来的请求
 * 少了某个字段时，语义必须仍然是「按最朴素的方式测一次」，否则升级服务端会
 * 让旧调用方悄悄换一套测法。
 */
export const ModelTestRunRequestSchema = z.object({
  protocol: ProtocolSchema,
  /** 不给模式就是流式：老界面、老脚本发的请求仍然按最朴素的方式跑一次。 */
  mode: ModelTestModeSchema.default('streaming'),
  providerIds: z.array(z.string()).optional(),
  modelIds: z.array(z.string()).optional(),
  /** 每个目标重复测几轮；默认 1，与旧行为逐字相同。 */
  rounds: z.number().int().min(MIN_MODEL_TEST_ROUNDS).default(1),
  /** 自定义提示词；留空按模式取默认值。 */
  prompt: z.string().optional(),
  /** 提示词补齐到的字符数；0 表示不补。 */
  inputLength: z.number().int().min(0).default(0),
})

export type ModelTestRunRequest = z.infer<typeof ModelTestRunRequestSchema>

/**
 * 一轮诊断的结论。
 *
 * 可空性是有语义的：`null` 表示**没测到**，`undefined` 表示**这一轮没有这个字段**。
 * 两者都不等于 `0`——上游没报用量与真的产出了零个 Token 是两件事，混成一个数
 * 会把「未知」摊进「零」的口径里。
 */
export interface ModelTestRoundResult {
  round: number
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  /**
   * 命中缓存的输入 Token：{@link inputTokens} 的**子集**，不是另一笔用量。
   *
   * 上游没报缓存字段时为 `null`——那与「命中了零个」不是一件事，界面据此写 `—`，
   * 而不是算出一个 `0%` 的命中率（口径见 `@common/metrics` 的 `cacheHitRate`）。
   */
  cachedInputTokens?: number | null
  ttftMilliseconds?: number | null
  tokensPerSecond?: number | null
}

/**
 * 一个「模型 × 协议」目标的诊断结论；顶层是各轮汇总，`rounds` 是逐轮明细。
 *
 * 汇总口径见 `apps/docs/specs/operations/diagnostics.md` §6（全部通过才算通过、状态码取第一个
 * 失败轮、耗时与用量取均值）。**界面不重新计算这些字段**，否则同一条结论在服务端
 * 日志与界面上会有两个数。
 */
export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  /** 这一次结果是按哪个模式测出来的。界面按它决定展示哪些列。 */
  mode: ModelTestMode
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  /** 命中缓存的输入 Token（`inputTokens` 的子集），各轮均值；上游没报时为 `null`。 */
  cachedInputTokens?: number | null
  /** 首字节耗时；只有流式/速度诊断量得到，其余模式与没收到正文时为 `null`。 */
  ttftMilliseconds?: number | null
  /**
   * 输出速度：**派生值**，任何模式都算，分母是本次尝试的端到端耗时（含首字等待）。
   *
   * 失败轮与拿不到输出 Token 时为 `null`——「没有速度」和「速度为零」是两件事。
   * 注意：`streaming` 模式的提示词只有一个词，这个比值基本由首字等待决定，读出来更接近
   * 「首字的倒数」而不是稳态出字速度；要稳态速度得看 `speed` 模式。字段本身照样有值，
   * 界面如实展示，不做猜测性的修正。
   */
  tokensPerSecond?: number | null
  /** 逐轮明细：单轮时只有一条，老界面可以完全忽略这个字段。 */
  rounds?: ModelTestRoundResult[]
}

/** `/api/model-test/run` 的响应体。每个被测目标一条，顺序与目标规划顺序一致。 */
export interface ModelTestRunResponse {
  results: ModelTestResult[]
}

/**
 * 模型对话框里「连接测试」的一行草稿端点。
 *
 * 刻意不是 `ProtocolEndpointSchema`：草稿里没有 id、没有自定义鉴权头，也不该有——
 * 这个接口测的是**表单里还没保存的那一份**，草稿本来就没有这些身份信息。
 */
export const ModelConnectivityEndpointSchema = z.object({
  protocol: ProtocolSchema,
  /** 模型级覆盖地址；留空表示用供应商级地址。 */
  endpointUrl: z.string().default(''),
})

/**
 * 连接测试的请求体。
 *
 * `modelName` 只 trim 不转义：用户要确认的正是「上游认不认这个名字」，我们替他
 * 规整过的名字测出来的是另一个名字。
 */
export const ModelConnectivityRequestSchema = z.object({
  providerId: z.string(),
  modelName: z.string().trim().min(1),
  /** 这次提交里启用的端点。空数组不是错误，是「还没配」，由界面拦在保存之前。 */
  endpoints: z.array(ModelConnectivityEndpointSchema).default([]),
})

export type ModelConnectivityRequest = z.infer<typeof ModelConnectivityRequestSchema>

/**
 * 一行草稿端点的探测结论。
 *
 * 与 {@link ModelTestResult} 的差别不只是字段少：它**不进观测**（不写请求日志、用量、
 * 健康冷却），因为它测的配置还没落库，没有 `providerModelId` 可挂，也没有「这个端点
 * 服务过一次真实请求」的事实可以记（见 `apps/docs/specs/operations/diagnostics.md` §2）。
 */
export interface ModelConnectivityResult {
  protocol: Protocol
  /** 本次实际请求的地址；这一行没有任何可用地址时为 `null`。 */
  endpointUrl: string | null
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  /**
   * 可本地化的错误码。只有契约里有的失败才有码（缺地址、上游拒凭证、超时……）；
   * 上游原话式的失败没有码，界面直接显示 `errorMessage`。
   */
  errorCode?: string
  /** `errorCode` 的模板变量。服务端不拼句子，界面按码取文案（见 `apps/docs/specs/data/i18n.md` §5）。 */
  errorParams?: TranslateParams
  /** 上游原话或本地诊断原文（英文）。 */
  errorMessage?: string
}

/** `/api/model/connectivity-test` 的响应体。一行草稿端点一条，顺序即提交顺序。 */
export interface ModelConnectivityResponse {
  results: ModelConnectivityResult[]
}
