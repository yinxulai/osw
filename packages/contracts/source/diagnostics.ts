import { z } from 'zod'

import type { TranslateParams } from './i18n/types'
import { ModelTestModeSchema, ProtocolSchema, type ModelTestMode, type Protocol } from './schemas'

/**
 * 渠道诊断的线上契约：**两端共用这一份**，服务端产出、界面消费。
 *
 * 为什么住在契约层而不是服务端路由里：这套形状原先被抄了三份——诊断路由一份、界面一份、
 * 连接测试一份，字段名与可空性各写各的。三份里任意两份漂移都不会有任何构建或测试报警，
 * 只会表现为「界面上那一格永远是 —」这种行为级故障。
 *
 *（那份被抄的服务端路由是 `routes/diagnostics/model-test.ts`，已经随任务队列一起删掉：
 * 今天诊断由 `tasks/kinds/model-test.ts` 这个 kind 跑，形状仍然只从本文件取。）
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
 * 队列里一个诊断任务的载荷。
 *
 * 它是「模型 × 协议 × 测法」的一次具体执行：一个载荷只描述**一个目标**，因为队列本身
 * 已经负责把一批任务排好、并发好、取消好——同一次请求里塞多个目标只会让「进度」与
 * 「取消」的粒度重新变成一个说不清的东西（见 `apps/docs/specs/overview/task-queue.md`）。
 *
 * 它是**队列的载荷**，不是 HTTP 请求体：它由界面按当前选中项与设置拼出来，随
 * `POST /api/tasks/enqueue` 一次性下发。
 */
export const ModelTestTaskItemSchema = z.object({
  modelId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  protocol: ProtocolSchema,
  /** 不给模式就是流式：只关心「通不通」的调用方拿到的仍是最全的读数。 */
  mode: ModelTestModeSchema.default('streaming'),
  /** 每个目标重复测几轮；默认 1。 */
  rounds: z.number().int().min(MIN_MODEL_TEST_ROUNDS).default(1),
  /** 自定义提示词；留空按模式取默认值。 */
  prompt: z.string().optional(),
  /** 提示词补齐到的字符数；0 表示不补。 */
  inputLength: z.number().int().min(0).default(0),
})

export type ModelTestTaskItem = z.infer<typeof ModelTestTaskItemSchema>

/** 去重键里能区分「这是哪一次诊断」的全部参数。 */
export interface ModelTestTaskKey {
  modelId: string
  protocol: Protocol
  mode: ModelTestMode
  rounds: number
  inputLength: number
}

/**
 * 键的版本前缀。格式发生变化时升版本，旧键自然认不出来，而不是被半懂不懂地解析。
 *
 * 格式：`v1:<编码后的模型 id>:<协议>:<模式>:<轮次>:<输入长度>`
 *（模型 id 是用户可写的字符串，用 `encodeURIComponent` 编进去，分隔符不会被它切错）。
 */
const MODEL_TEST_TASK_KEY_PREFIX = 'v1'

/**
 * 诊断任务去重键的**唯一构造处**，服务端 `keyOf` 与界面读键共用这一份。
 *
 * 键里必须带 `mode` / `rounds` / `inputLength`：只带「模型 × 协议」会把「同一目标换了
 * 参数重测」误判成重复任务而静默跳过——用户看到的是「点了没反应」。
 * 反过来，键相同就只能是同一件事：同一目标、同一套参数，确实不该同时在飞两份。
 */
export function modelTestTaskKeyOf(identity: ModelTestTaskKey): string {
  return [
    MODEL_TEST_TASK_KEY_PREFIX,
    encodeURIComponent(identity.modelId),
    identity.protocol,
    identity.mode,
    String(identity.rounds),
    String(identity.inputLength),
  ].join(':')
}

/**
 * 解析 {@link modelTestTaskKeyOf} 的产物；形状不对返回 `null`。
 *
 * 返回 `null` 而不是抛：键来自网络上另一头（或一次版本升级之前留下的任务），一条认不
 * 出来的任务应该被跳过，而不是让整张表渲染失败。
 */
export function parseModelTestTaskKey(key: string): ModelTestTaskKey | null {
  const parts = key.split(':')
  if (parts.length !== 6) return null
  const [prefix, encodedModelId, protocolText, modeText, roundsText, inputLengthText] = parts
  if (prefix !== MODEL_TEST_TASK_KEY_PREFIX) return null

  let modelId: string
  try {
    modelId = decodeURIComponent(encodedModelId)
  } catch {
    return null
  }
  if (modelId.length === 0) return null

  const protocol = ProtocolSchema.safeParse(protocolText)
  if (!protocol.success) return null
  const mode = ModelTestModeSchema.safeParse(modeText)
  if (!mode.success) return null

  // 只认规范写法：`01` 与 `1` 不能是两个能对上的键。
  const rounds = Number(roundsText)
  if (!Number.isSafeInteger(rounds) || rounds < MIN_MODEL_TEST_ROUNDS || String(rounds) !== roundsText) return null
  const inputLength = Number(inputLengthText)
  if (!Number.isSafeInteger(inputLength) || inputLength < 0 || String(inputLength) !== inputLengthText) return null

  return { modelId, protocol: protocol.data, mode: mode.data, rounds, inputLength }
}

/**
 * 诊断任务的进行中画面。
 *
 * 身份字段（模型 / 渠道名）要一起带上：任务的 `progress` 是**唯一**能让一个还没跑完
 *（甚至只是排队中）的任务在界面上说出「我是谁」的东西——通用队列不认识任何业务字段
 *（见 `@common/tasks` 的 `TaskRecord`）。
 *
 * `result` 是**已完成轮次**的汇总结论（`summarizeRounds`），一轮都没跑完时为 `null`；
 * 它和前一条 `progress` 一样，是同一个「唯一定义处」算出来的值，界面不重算。
 */
export interface ModelTestTaskProgress {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  mode: ModelTestMode
  /** 已经跑完的轮数；还没跑完第一轮时是 0。 */
  round: number
  totalRounds: number
  result: ModelTestTaskResult | null
}

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

/**
 * 一条诊断**任务**的结论：{@link ModelTestResult} 加上它测的是哪个协议。
 *
 * 协议为什么不在 `ModelTestResult` 里：那个类型是「一次诊断请求的产出」，而发出请求的那一方
 * 本来就知道自己请求的是哪个协议，所以它没有把协议抄进结论。队列之后情形反过来了——
 * 结论由**服务端**产出、由任意一个订阅者消费，谁都不知道这条结论是从哪条任务来的，
 * 协议必须跟着结论一起走。差异只在这一个字段，所以用交叉类型而不是复制一遍。
 */
export interface ModelTestTaskResult extends ModelTestResult {
  protocol: Protocol
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
