/**
 * 共享重写规则目录的契约：**本机 → 目录服务（`apps/apis`）→ 本机**的报文格式。
 *
 * ## 它解决什么
 *
 * 请求重写规则目前只能本机自己建。同一个兼容性问题（某个中转要改 `User-Agent`、某个模型
 * 要删一个私有字段）会被很多人各写一遍，写出来的又大同小异——差别往往只是笔误。这个目录让
 * 一条规则可以被**匿名发布**一次、被**别人直接用**，并且**按被用的次数排名**，于是「最好的
 * 那条」自己浮上来，而不需要谁去维护一份清单。
 *
 * ## 三条刻意的性质
 *
 * 1. **匿名，没有账号。** 发布不携带任何身份，服务端也不回身份——所以规则里**不能有**任何
 *    指向某个人的字段。排名只看「被用过多少次」，不看谁写的、谁用的。
 * 2. **保存即用，没有「安装」这一步。** 目录里的东西不是需要订阅的包，只是一份可以被立刻
 *    拷进本地规则库的内容。所以这里的动词只有 `publish`（发一条）与 `use`（用一条，
 *    顺带把计数 +1），没有 install / subscribe / sync 这些会暗示「所持状态」的词。
 * 3. **规则内容就是本机的规则内容。** 载荷复用 `RequestRewriteRuleSchema` 里的
 *    `match` / `actions` / `testCases`，不另起一套。目录**不重新定义**一条规则长什么样：
 *    一处定义、两端共用，才不会出现「本机能跑、装回来跑不动」。
 *
 * ## 为什么身份不进载荷，而排序却需要「用了几次」
 *
 * 用一次就 +1 是一个**计数器**，不是一个「谁用了」的名单。计数器回答「这条规则值不值得试」，
 * 名单回答「谁在用」——前者是产品要的，后者是隐私账里最不该留的那一项。所以计数的写入路径
 * 只累加一个数字，处理完这次请求，队列里没有任何可关联到某台机器的字段。
 *
 * 本文件不 import 任何 Node 内置模块：它是契约，Worker 跑在 V8 isolate 里
 * （见 `packages/toolkit/scripts/check-package-boundaries.mjs`）。
 */

import { z } from 'zod'
import { RESPONSE_REWRITE_ENABLED } from './features'
import {
  RequestRewriteRuleActionSchema,
  RequestRewriteRuleMatchSchema,
  RequestRewriteRuleTestCaseSchema,
  RuleScopeSchema,
} from './schemas'

// ========== 端点 ==========

/**
 * 共享规则目录的路径前缀。**客户端里写死的唯一地址的第二段**（第一段是遥测的 `/v1/track`）。
 *
 * 它与遥测同域（`apps/apis` 这一个 Worker 同时服务两者），因为它描述的是同一类东西：一处
 * 由我们运营、客户端不持有任何凭证的公共服务。路径里的 `v1` 与前缀一样，是**请求格式**的
 * 版本，不是数据去向的版本——兼容窗口同样是「永久」，破坏性变更开新路径并长期保留旧解析。
 */
export const SHARED_REWRITE_RULES_PATH = '/v1/rules'

/**
 * 目录的默认端点：与遥测**同域**（同一个 Worker 的第二条路由）。
 *
 * 与 `TELEMETRY_ENDPOINT` 一样，它是客户端里写死的地址、发布出去就是永久地址。放在这里而不是
 * 让调用方自己拼「遥测地址换个路径」，是因为两者的域名必须一起变：拼出来的地址会在「只改了遥测
 * 端点」时悄悄指向旧域，而那正是最难发现的一类漂移。
 */
export const SHARED_REWRITE_RULES_ENDPOINT = 'https://api.osw.yinxulai.com/v1/rules'

/** 列表 / 详情 / 发布 / 使用四条子路径。写在这里，客户端与服务端各写一份必然漂移。 */
export const SHARED_REWRITE_RULE_ACTIONS = ['list', 'get', 'publish', 'use'] as const
export type SharedRewriteRuleAction = (typeof SHARED_REWRITE_RULE_ACTIONS)[number]

// ========== 上限 ==========

/**
 * 一次请求的字节上限，64 KiB。
 *
 * 与遥测报文同一个量级：规则本来就不大（脚本源码上限 20 000 字符，见
 * `REWRITE_SCRIPT_CODE_LIMIT`），但一条规则可能带 50 个动作、50 个用例，所以留出与遥测
 * 相同的余量。超限一律拒绝，**不截断**——截断会静默改变规则内容，比直接失败更危险。
 */
export const SHARED_REWRITE_RULES_MAX_REQUEST_BYTES = 64 * 1024

/**
 * 单条规则名与说明的长度上限，与本地规则一致（`RequestRewriteRuleSchema`）。
 *
 * 目录不该比本机更宽容：一条在本机能存、发到目录被拒，或反过来，都会让「保存即用」出现
 * 一个两边都能看到、却对不上的缝。
 */
export const SHARED_REWRITE_RULE_MAX_NAME_LENGTH = 100
export const SHARED_REWRITE_RULE_MAX_DESCRIPTION_LENGTH = 1000

/** 列表一页最多返回多少条。**服务端硬上限**：界面要更少是界面的事。 */
export const SHARED_REWRITE_RULES_MAX_LIST_LIMIT = 100
/** 列表默认一页多少条。 */
export const SHARED_REWRITE_RULES_DEFAULT_LIST_LIMIT = 30
/** 关键词搜索的长度上限；超长直接截断判断，不入库、不回显。 */
export const SHARED_REWRITE_RULES_MAX_QUERY_LENGTH = 100

// ========== 载荷：一条可以被发布的规则 ==========

/**
 * 一条规则里**由作者撰写、可以被别人直接用**的那一半。
 *
 * 它刻意不含 `id` / `createdTime` / `updatedTime` / `deletedTime`（这些是存储事实，由目录
 * 在收到时产生），也不含 `enabled` 与 `source`：前者是**本地**的启用状态（装回来默认是启用，
 * 但那是本机的决定，不是作者写在内容里的），后者是本机的来源标注（装回来的东西来源就是
 * `imported`，见 `@common/schemas` 的 `RequestRewriteRuleSchema.source`）。
 *
 * `match` / `actions` / `testCases` 直接复用本机的 schema：目录**不重新定义**一条规则，
 * 否则「本机能跑」与「装回来能跑」就成了两件需要各自验证的事。
 */
export const SharedRewriteRulePayloadSchema = z.object({
  name: z.string().min(1).max(SHARED_REWRITE_RULE_MAX_NAME_LENGTH),
  description: z.string().max(SHARED_REWRITE_RULE_MAX_DESCRIPTION_LENGTH).default(''),
  scope: RuleScopeSchema,
  schemaVersion: z.number().int().positive().default(1),
  match: RequestRewriteRuleMatchSchema.default({}),
  actions: z.array(RequestRewriteRuleActionSchema).min(1).max(50),
  testCases: z.array(RequestRewriteRuleTestCaseSchema).max(50).default([]),
}).strict()
export type SharedRewriteRulePayload = z.infer<typeof SharedRewriteRulePayloadSchema>

// ========== 记录：目录里的一条规则 ==========

/**
 * 一条被发布的规则，也就是列表与详情返回的形状。
 *
 * `id` 由目录按**内容的签名**派生（见 `apps/apis/source/registry/`），因此同一份内容重复
 * 发布得到同一个 `id`：发布是幂等的，不会把一条好规则堆成很多份，也不会在每次发布时把
 * 它的用量清零。`usageCount` 是「被用过多少次」，就是排名依据，也是**唯一的**一条热度信号
 * ——没有点赞、没有评分、没有作者的其它规则，因为那些都会把「匿名」这层纸捅破。
 */
export const SharedRewriteRuleSchema = SharedRewriteRulePayloadSchema.extend({
  id: z.string().min(1),
  usageCount: z.number().int().nonnegative(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type SharedRewriteRule = z.infer<typeof SharedRewriteRuleSchema>

// ========== 请求 / 响应 ==========

/** 列表的排序方式。只有两种，因为只有两条能回答「先看哪条」。 */
export const SharedRewriteRuleSortSchema = z.enum(['popular', 'recent'])
export type SharedRewriteRuleSort = z.infer<typeof SharedRewriteRuleSortSchema>

export const SharedRewriteRuleListInputSchema = z.object({
  /** 关键词，匹配名称与说明。大小写不敏感，空白忽略。 */
  query: z.string().max(SHARED_REWRITE_RULES_MAX_QUERY_LENGTH).default(''),
  sort: SharedRewriteRuleSortSchema.default('popular'),
  limit: z.number().int().positive().max(SHARED_REWRITE_RULES_MAX_LIST_LIMIT).default(SHARED_REWRITE_RULES_DEFAULT_LIST_LIMIT),
  offset: z.number().int().nonnegative().default(0),
})
export type SharedRewriteRuleListInput = z.infer<typeof SharedRewriteRuleListInputSchema>

export const SharedRewriteRuleListResultSchema = z.object({
  rules: z.array(SharedRewriteRuleSchema),
  /** 满足筛选条件的总条数（不受本页 `limit` 影响），用来渲染「还有更多」。 */
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
})
export type SharedRewriteRuleListResult = z.infer<typeof SharedRewriteRuleListResultSchema>

export const SharedRewriteRuleGetInputSchema = z.object({ id: z.string().min(1) })
export type SharedRewriteRuleGetInput = z.infer<typeof SharedRewriteRuleGetInputSchema>

export const SharedRewriteRulePublishInputSchema = z.object({ rule: SharedRewriteRulePayloadSchema })
export type SharedRewriteRulePublishInput = z.infer<typeof SharedRewriteRulePublishInputSchema>

/** 「用一条」：把这条规则拷进本地规则库时调一次，计数 +1。 */
export const SharedRewriteRuleUseInputSchema = z.object({ id: z.string().min(1) })
export type SharedRewriteRuleUseInput = z.infer<typeof SharedRewriteRuleUseInputSchema>

// ========== 校验辅助 ==========

/**
 * 响应阶段在这个目录里是**不可发布**的：它整段受 `RESPONSE_REWRITE_ENABLED` 闸门控制
 * （见 `@common/features`），本机保存与试跑都会被挡。目录必须用同一道闸门——否则会出现
 * 「能发布、但装回来存不下」的规则，那比目录里根本没有这条规则更糟。
 *
 * 返回一句可照做的理由，或 `null` 表示放行。放在契约层是因为**三个地方要问同一个问题**
 * （Worker 的发布口、内核的安装口、界面的发布按钮），各写一份判断迟早会漂。
 */
export function sharedRewriteRuleDisabledReason(payload: SharedRewriteRulePayload): string | null {
  if (RESPONSE_REWRITE_ENABLED) return null
  if (payload.actions.some(action => action.stage === 'response')) return 'Response-stage actions cannot be published: streaming responses cannot be rewritten yet'
  if (payload.testCases.some(testCase => testCase.stage === 'response')) return 'Response-stage test cases cannot be published: streaming responses cannot be rewritten yet'
  return null
}
