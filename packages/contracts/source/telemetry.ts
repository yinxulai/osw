/**
 * 上报接口契约：**客户端 → Worker 的报文格式**，也就是两端之间唯一的一份约定
 * （默认开启、界面上不提供开关，见 `docs/product/telemetry.md`）。
 *
 * ## 这个接口只描述事实
 *
 * 一份报文说的是一件事：**一台匿名的机器，在某个时刻，发生了一件产品上的事**。
 * 它不说这件事将被存到哪里，也不为任何具体的分析系统留字段、留位置——这里没有 `client_id`、
 * 没有 `user_properties`、没有「事件参数」这类词，也没有一个上限是从某家后端的文档里抄来的。
 * 客户端不知道下游是谁，也不需要知道（那条边界在 `apps/apis/source/sink.ts`）。
 *
 * 所以「换一套存储」对这份契约是零影响：适配器负责把这里的字段翻译成目标系统的语言，
 * 翻译不过来是那次改动的成本，而不应该变成契约的形状。判断一个字段该不该加只有一条标准：
 * **它在描述发生的事，还是描述它要去哪？** 后者一律不加。
 *
 * ## 三条不能随手改的性质
 *
 * 1. **事件名与属性名是闭集，只增不删。** 删掉一个名字等于历史数据里那一列失去解释。
 *    要停用就在文档里标「已停用」并停止发送，不是从这张表里移除。
 * 2. **这里不出现自由文本字段。** 属性值只能是固定枚举或布尔（见「属性规则」），
 *    所以没有任何位置能塞进一个 URL、一个供应商名或一段用户内容。首版曾为「当下什么模型
 *    热门」开过一扇小窗（模型名），后来连它一起撤掉了：那个问题不值得用一条用户自己写下的
 *    字符串去换（telemetry.md §3）。
 * 3. **约束要在这里卡死，不能指望下游报错。** 几乎所有的分析后端对超长、非法或不在词表里的
 *    值都是**不报错、直接丢**（telemetry.md §9），所以「长度对不对、值合不合法」必须是这里
 *    的类型问题，而不是运行期问题。
 *
 * 本文件不 import 任何 Node 内置模块：它是契约，Worker 跑在 V8 isolate 里（见
 * `packages/toolkit/scripts/check-package-boundaries.mjs`）。
 */

import { z } from 'zod'
import { HOST_RUNTIMES } from './runtime-config'
import { WORKFLOW_NODE_KINDS } from './router/types'
import { ProtocolSchema, RouteModeSchema } from './schemas'

// ========== 端点 ==========

/**
 * 上报端点。**客户端里写死的唯一一个地址。**
 *
 * 这是「已经发出去的客户端里的地址改不了了」那句话的落点（telemetry.md §6）：
 * 换分析后端、换存储、换数据驻留区域、整站迁移，都只动 Worker，客户端一行都不用改。
 * 所以它的改动门槛比看上去高得多，上线前就该当作永久前缀来选。
 *
 * 必须是自有域名，**不能是 `workers.dev` 子域**：后者绑在平台命名空间上，改名即作废。
 */
export const TELEMETRY_ENDPOINT = 'https://api.osw.yinxulai.com/v1/track'

/**
 * 路径里的 `v1` 是**请求格式**的版本，不是数据去向的版本。
 *
 * 端点不变意味着会有很旧的客户端一直打过来，所以兼容窗口是「永久」而不是「支持几个版本」：
 * 新增字段一律可选，破坏性变更开新路径并**长期保留旧解析**（telemetry.md §7）。
 *
 * 末段叫 `track` 而不是 `events`：这条路径是整个域名上唯一的一条，名字应当直接说出
 * 「这里是收埋点的地方」，而不是依赖上下文才知道 `events` 是谁的事件。
 */
export const TELEMETRY_REQUEST_PATH = '/v1/track'

// ========== 上限 ==========

/**
 * 一份报文的字节上限，64 KiB。
 *
 * 这是一条**传输层**的线，不是产品口径：一批 25 条事件的实际体积在 4 KiB 量级，离它很远。
 * 写在这里而不是只写在 Worker 里，是为了让客户端能先自查一次，也为了让它只是一个数字。
 */
export const TELEMETRY_MAX_REQUEST_BYTES = 64 * 1024

/**
 * 单批事件数上限，25。
 *
 * 它只由「一次上报不该明显拖慢关闭流程」与「请求要够小」推出来，与下游无关。
 * Worker 对超长批次**拒绝而不是截断**——截断会静默改变统计口径，比丢一批更难发现。
 */
export const TELEMETRY_MAX_EVENTS_PER_BATCH = 25

/**
 * 属性值的长度上限，100。
 *
 * **一个数字管所有属性值。** 早先这里按「事件参数 100 / 用户属性 36」分两套，那是把某家后端的
 * 实现细节写进了双方的契约；现在它只服务于「一段值不可能长到藏下一段内容」这个目的。
 */
export const TELEMETRY_MAX_PROPERTY_VALUE_LENGTH = 100

/**
 * 时间戳可回溯的窗口，72 小时。
 *
 * 比这更早的事件多半是休眠很久之后的一次补报，而下限存在的意义是让「什么时候发生的」
 * 不至于变成一个无从考证的数字。超出窗口时 Worker 的做法是**丢掉时间戳而不是丢掉事件**
 * （telemetry.md §7）——补报允许损失时间精度，但整批数据没了是另一回事。
 */
export const TELEMETRY_MAX_BACKDATE_MILLISECONDS = 72 * 60 * 60 * 1000

/**
 * 上报请求的超时（毫秒），不参与任何重试预算。
 *
 * 它同时是 Worker 侧转发超时的上界：下游必须在客户端放弃之前答完，否则就会出现「客户端
 * 以为失败了、下游其实收到了」（见 `apps/apis/source/sink.ts`）。
 */
export const TELEMETRY_REQUEST_TIMEOUT_MILLISECONDS = 5_000

/**
 * 默认批量条数。
 *
 * 远小于 25 的硬上限：批量只为了少发几次请求，不是为了攒到极限。
 */
export const TELEMETRY_DEFAULT_BATCH_SIZE = 12

/** 凑不满一批时的最长等待（毫秒）；先到先发。 */
export const TELEMETRY_FLUSH_INTERVAL_MILLISECONDS = 30_000

// ========== 信封 ==========

/**
 * 每条事件都带的字段，由客户端填写。
 *
 * 它是这份契约里**最抽象的一层**：与具体发生了什么无关，只回答「谁、什么时候、在什么上」。
 * 业务属性另行定义（见事件目录），写事件的人只关心自己那几个属性，信封由上报器统一补
 * （见 `TelemetryEventInput`）。
 *
 * 这里没有「用户」「会话」「设备」这类词，只有事实：安装标识、时间、版本、平台、语言、
 * 宿主形态。换个后端，它们可能被叫作别的名字，但那是那边的事，不是这里的命名依据。
 */
export const TelemetryEnvelopeSchema = z.object({
  /** 事件发生时间，本地时钟的毫秒时间戳。 */
  occurredAt: z.number().int().nonnegative(),
  /**
   * 本机匿名安装标识，标准 UUID v4。
   *
   * 直接上报本地 UUID，**不派生、不轮换**：它是「同一台机器」的唯一凭据，轮换换不到真正的
   * 匿名，却会把「跨天的活跃与留存」整个废掉（telemetry.md §4）。
   */
  installId: z.string().uuid(),
  /**
   * 应用版本，由宿主注入（core 拿不到渲染层的版本常量，也没有 electron）。
   */
  version: z.string().min(1).max(TELEMETRY_MAX_PROPERTY_VALUE_LENGTH),
  /** 操作系统。 */
  os: z.enum(['win32', 'darwin', 'linux']),
  /** CPU 架构。 */
  arch: z.enum(['x64', 'arm64', 'ia32']),
  /** 用户实际选择的界面语言，不是系统语言。 */
  locale: z.enum(['en', 'zh-CN']),
  /** 宿主形态。枚举来自运行时配置，不在这里另抄一份。 */
  runtime: z.enum(HOST_RUNTIMES),
})

export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>

/** 信封字段名，供「组装事件」的地方一次性剔除。 */
export const TELEMETRY_ENVELOPE_FIELDS = [
  'occurredAt',
  'installId',
  'version',
  'os',
  'arch',
  'locale',
  'runtime',
] as const

// ========== 属性规则 ==========

/**
 * 一个属性值只允许两种类型：**有界字符串**与**布尔**。
 *
 * 没有数字、没有数组、没有对象——不是因为下游不支持，而是因为这份契约的红线
 * 是「不存在任何位置能塞进一段内容」（见文件头）。要表达「几个」就用枚举（见
 * `TELEMETRY_FAILOVER_ATTEMPT_BUCKETS`），不要发一个恰好是数字的字符串。
 *
 * 有界字符串就是**枚举**（值来自固定词表）：没有「自由文本属性」这个类别，也不打算再加一个
 * ——要表达一段用户写下的内容时，先回文件头看第 2 条。
 *
 * 每条事件自己的属性仍然按**固定枚举**逐个写出来（见事件目录）；这个 schema 表达的是那条
 * 更宽的规则，也是「新增一个属性时它能是什么类型」的答案。
 */
export const TelemetryPropertyValueSchema = z.union([
  z.string().max(TELEMETRY_MAX_PROPERTY_VALUE_LENGTH),
  z.boolean(),
])

// ========== 事件目录（首版，只增不删） ==========

/** `service_start_failed.reason`：启动失败的归因分桶。 */
export const TELEMETRY_SERVICE_FAILURE_REASONS = ['instance_lock', 'port', 'database', 'other'] as const

/** 供产出失败归因的地方直接引用，不必写 `Extract<...>`。 */
export type TelemetryServiceFailureReason = (typeof TELEMETRY_SERVICE_FAILURE_REASONS)[number]

/**
 * `failover_happened.attempts`：**分桶，不发精确次数**。
 *
 * 精确值对产品决策没有额外信息量，却是更细的行为指纹。
 *
 * 桶从 `2` 起，因为「转移」本身就意味着还有下一个候选要试：这个值记的是**转移之后落在
 * 第几次尝试上**（第一次转移＝「改试第 2 个候选」），而不是已经失败的次数。
 */
export const TELEMETRY_FAILOVER_ATTEMPT_BUCKETS = ['2', '3', '4+'] as const

/** 供产出分桶的地方直接引用，不必写 `Extract<...>`。 */
export type TelemetryFailoverAttemptBucket = (typeof TELEMETRY_FAILOVER_ATTEMPT_BUCKETS)[number]

/** `rewrite_rule_created.kind`：规则来源。 */
export const TELEMETRY_REWRITE_RULE_KINDS = ['builtin', 'custom'] as const

/**
 * 布尔属性用原生 JSON 布尔。
 *
 * 早先它是 `'true'` / `'false'` 两个字符串，唯一的理由是某家后端只吃字符串参数；那属于
 * 适配器该操心的事，把类型退化写进契约只会让每个读报文的人都得多想一次。
 */
const TelemetryBooleanSchema = z.boolean()

/**
 * 事件名的闭集。
 *
 * 每一项是一句话能说清的产品事实，不是一次函数调用。判断标准见 telemetry.md §5.3：
 * 事件目录就是**需求边界**，表里没有的问题首版不加字段，先在文档里加一行再说。
 *
 * ## 命名规则
 *
 * 名字一旦发出去就不能改（见下面「只增不删」），所以它必须一次就说清，而且在一张表里读起来
 * 是**同一种句式**。规则有五条，每一条都由 `telemetry.test.ts` 机械检查——写成文字只是解释，
 * 能不能通过看测试：
 *
 * 1. **形态是 `<主体>_<谓词>`。** 全小写 ASCII，只用字母、数字与下划线，以字母开头，
 *    不带 `$` / `_` 前缀（那是各家后端给自己留的保留名），也不带 `-`、`.`、空格、版本号。
 *    `provider.created` / `ProviderCreated` / `v2_provider_created` 都不是这里的样子。
 * 2. **主体是产品名词的单数**，是这件事的主角：`provider` / `route_mode` / `request`。
 *    不是界面元素，不是函数名，也不是「谁点的」（`provider_created`，而不是
 *    `createDialogOpened`）——「谁触发的」是另一条事件或属性要回答的，不该编进名字里。
 * 3. **谓词是过去分词。** 事件永远描述**已经发生**的事实：祈使式 / 现在时（`provider_create`）
 *    在说「将要」，名词化的动名词（`provider_creation`）在说「一个东西」，都不是在说「发生了」。
 *    唯一看上去像是例外的是 `run`（它的过去分词长得一样），但也就是它造成了歧义：
 *    `provider_test_run` 读起来是「一次测试运行」，而这条事件说的是「测试过了」——
 *    所以它叫 `provider_tested`，不叫 `provider_test_run`。
 * 4. **谓词取自一张封闭的动词表**（`TELEMETRY_EVENT_PREDICATES`），一个意思只用一个词。
 *    表外的动词要先加表、再加事件，两件事必须同一次改动。
 *
 *    | 谓词 | 含义 | 现有用例 |
 *    |------|------|---------|
 *    | `started` | 进程 / 服务开始运行 | `app_started` |
 *    | `finished` | 一段流程走到终点（含被跳过） | `onboarding_finished` |
 *    | `failed` | 进程 / 服务以失败告终 | `service_start_failed` |
 *    | `completed` | 一个工作单元被完整服务完（成功） | `request_completed` |
 *    | `created` | 一个新的持久实体出现 | `provider_created` / `model_created` / `rewrite_rule_created` |
 *    | `changed` | 一个既有设置 / 状态的取值变了 | `route_mode_changed` |
 *    | `tested` | 一次探测性执行得出了结论 | `provider_tested` |
 *    | `executed` | 一个执行步骤跑过 | `workflow_node_executed` |
 *    | `used` | 一项产品能力被实际用上 | `protocol_conversion_used` |
 *    | `happened` | 自动发生的中性事实，不是成功也不是失败，也不是谁的动作 | `failover_happened` |
 *
 *    「新建一个 Provider」与「添加一个模型端点」是同一件事，所以共用 `created`：早先后者叫
 *    `model_added`，而 `added` 是 `created` 的同义词——同一张表里摆两个同义词，读的人只能
 *    去猜它们有什么差别。
 * 5. **属性名也是小写下划线**（`node_kind`，不是 `nodeKind`）。信封字段是例外：那几个是
 *    camelCase，因为它们由我们自己的代码填、在两端都是同名的 TypeScript 标识符；而事件名
 *    与事件属性是要长期发到线上、给分析侧看的**词表**，词表用下划线。同名属性在不同事件里
 *    必须同义、同词表（`kind` 在 `provider_created` 与 `rewrite_rule_created` 里都是
 *    `builtin` / `custom`）。
 *
 * 这些名字与当前后端的保留名不冲突（它的保留名全部以 `$` 开头）。将来接一个新后端时如果
 * 撞上了，解决办法是在适配器里做映射，**不是把契约里的名字改掉**：名字发出去就不能变。
 *
 * 四个名字曾经存在又被撤掉，理由分两类：
 *
 * - `popular_models` / `provider_model` 要把**模型名**（用户自己写下的一段字符串）带出去；
 * - `telemetry_toggled` / `logs_exported` 是**没有信息量的产品事实**：前者对应一个不存在的
 *   开关（界面上没有任何入口，用户触发不到），后者只有一个恒为 `false` 的 `withContent`
 *   ——「用户点过一次下载」不值得单独占一个事件名。
 *
 * 从未发出过的名字可以直接移除，不留「已停用」的占位——「只增不删」防的是历史数据失去解释，
 * 而不是防改动本身。真需要时再加回来：`telemetry_toggled` 对应「界面上出现开关」这个功能，
 * `logs_exported` 对应「有一种会带上用户内容的导出」，两者都是先有功能再有事件。
 */
export const TelemetryEventSchema = z.discriminatedUnion('name', [
  /** 服务启动完成。 */
  z.object({ ...TelemetryEnvelopeSchema.shape, name: z.literal('app_started') }).strict(),
  /** 启动最终失败。`reason` 是归因分桶，不带错误原文——那是排障信息，不是统计。 */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('service_start_failed'),
    reason: z.enum(TELEMETRY_SERVICE_FAILURE_REASONS),
  }).strict(),
  /** 引导走完或跳过。`skipped` 为真表示没走完就退出——它与「走完了」是两种不同的结果。 */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('onboarding_finished'),
    skipped: TelemetryBooleanSchema,
  }).strict(),
  /**
   * 生效模式切换。**真的从一种切到另一种时发一条**：设置接口会把整个设置对象回写一遍，
   * 按「收到这个字段」计数只会数出「保存过几次设置」。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('route_mode_changed'),
    mode: RouteModeSchema,
  }).strict(),
  /**
   * 新建 Provider。只发来源，不发名称与地址。
   *
   * `builtin` 指从内置预设（`provider-presets.ts`）起手建的，「从零手填」与导入都算 `custom`。
   * 这个判定只有界面侧知道——core 收到的创建请求里没有「来源」这个概念，也不该有：
   * 它描述的是用户怎么走到这一步的，不是服务端的事实。
   *
   * 导入是唯一一条由 core 自己判定的路径（它不经管理接口的创建入口）：包里的供应商在本地
   * **还不存在**才算新建，按名覆盖已有的那条不发——那是一次更新，不是「建出来了」。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('provider_created'),
    kind: z.enum(['builtin', 'custom']),
  }).strict(),
  /**
   * 新建 ProviderModel（界面上就是「添加模型」）。协议是产品能力维度，不是供应商标识。
   *
   * 谓词用 `created` 而不是 `added`：它与 `provider_created` / `rewrite_rule_created` 是
   * 同一件事（一个新实体落库了），共用同一个词才是那张动词表的意义（见上面的命名规则）。
   *
   * 事情的主体是**端点绑定**，不是那个模型行：一个模型可以同时绑多个协议端点，**每个端点
   * 各发一条**，挑一个发等于把「这个模型支持哪几种协议」答成残缺的，而事件次数正是
   * 「这类能力被接进来几次」的计数。因此一条端点都没配的模型不发——加进去的其实是
   * 「一个还没有能力的壳」，而这条事件问的正是能力。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('model_created'),
    protocol: ProtocolSchema,
  }).strict(),
  /**
   * 连接测试（`provider` 是被测对象，`tested` 是发生在它身上的事）。
   *
   * **每个被测目标一条**：界面上点一次「测试全部模型」是若干个目标，界面侧把它们拆成若干次
   * 服务端请求（`model-test.ts` 一次请求只测一个目标），拿到结论就发一条，`result` 说的是
   * **那一个目标**的结论。事件次数因此是「测过多少个上游目标」，比「点了几次测试」更细，
   * 也更接近要回答的问题——「这些接进来的端点真的连得上吗」。
   *
   * 中途被取消的那次不发：它没有结论，记成 `failed` 会把「用户点了取消」算进失败率里；
   * 跑完了但一个结果都没有（一个候选都没落下来）同样不发。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('provider_tested'),
    result: z.enum(['success', 'failed']),
  }).strict(),
  /**
   * 新建请求改写规则。
   *
   * 规则的来源在库里是三档（`user` / `builtin` / `imported`），这里只有两档：
   * 内建模板是一种，用户自己写的与导入的都算自定义——这个属性要回答的是「内建规则有人用吗」。
   *
   * `source` 由界面在保存时写进请求体：按模板生成的草稿（以及它的副本）是 `builtin`，
   * 空白规则是 `user`（见 `rule-presets.ts`）。core 只做映射，不去猜来源。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('rewrite_rule_created'),
    kind: z.enum(TELEMETRY_REWRITE_RULE_KINDS),
  }).strict(),
  /**
   * 一次请求发生了协议转换；两侧都记，否则「转换从哪来到哪去」这一格读不出来。
   *
   * **一次转换一条**：转移目标换了协议、或一次请求试了两个协议不同的候选，就是两次转换。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('protocol_conversion_used'),
    from: ProtocolSchema,
    to: ProtocolSchema,
  }).strict(),
  /**
   * 一次请求发生了故障转移。**每转移一次发一条**（一次请求可能发好几条）。
   *
   * 只有「确实还有下一个候选」才算转移：最后一个候选也失败时走的是「候选耗尽」，
   * 那里没有可转移的对象，也就没有这条事件。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('failover_happened'),
    attempts: z.enum(TELEMETRY_FAILOVER_ATTEMPT_BUCKETS),
  }).strict(),
  /**
   * 工作流节点执行。**每执行过一个节点发一条**，因此这是事件目录里量最大的一条：
   * 一次请求可能连跑好几个节点，批量队列（见 §12）就是为它存在的。
   *
   * 「执行过」是字面意思：轨迹里还留着两种没跑过逻辑的步骤——**节点被禁用而跳过**，以及
   * 图里没有输入节点时那条「初始化」占位。它们带 `executed: false`（`@common/router/types`
   * 的 `WorkflowTrace`），发事件前先滤掉，否则「节点用得怎么样」里会混进没发生的事。
   *
   * `node_kind` 的取值**就是** `@common/router/types` 的 `WORKFLOW_NODE_KINDS`，
   * 不在这里再抄一份枚举：节点类型是路由领域的词，它变了这里跟着变才对。
   *
   * 属性名写 `node_kind` 而不是 `nodeKind`：事件属性是发到线上的词表，词表用下划线，
   * camelCase 留给信封里那些由我们自己的代码填的字段（见上面的命名规则第 5 条）。
   *
   * 这一格必须是枚举而不是字符串。契约的红线是「不存在任何自由文本字段」（telemetry.md §3），
   * 而 40 个字符足够塞进一段 URL；节点类型清单收缩时老客户端会在这层被拒，那正是
   * 「破坏性变更开新路径」这条既有约定的适用场景（§7）。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('workflow_node_executed'),
    node_kind: z.enum(WORKFLOW_NODE_KINDS),
  }).strict(),
  /**
   * 一次请求被本机代理处理成功。**每成功一次发一条，事件次数就是处理过的任务数。**
   *
   * 它是唯一一条没有任何属性的业务事件。这不是省事，而是唯一合法的形状：要回答「这台机器
   * 一共处理了多少任务」，**数量只能由事件次数表达**——属性里没有位置能放数字，而自由文本
   * 是被禁掉的（telemetry.md §3）。所以它也不带耗时、Token、状态码：那些是用户的业务数据，
   * 属于本地观测（telemetry.md §15）。
   *
   * **只在处理成功时发。** 失败、被取消的请求不发：它们由 `failover_happened` /
   * `service_start_failed` 之类的专门事件回答，混进计数里会让「处理了多少任务」失去意义。
   *
   * **只记客户端请求。** 产品自己发起的内部执行——连接测试、工作流的模型节点、能力自检——
   * 走的是同一条代理执行链，但它们不是「替客户端处理的任务」：它们各自的用量由自己的事件
   * 回答（`provider_tested` / `workflow_node_executed`），再计一次就把一次任务数成两次以上。
   */
  z.object({
    ...TelemetryEnvelopeSchema.shape,
    name: z.literal('request_completed'),
  }).strict(),
])

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>
export type TelemetryEventName = TelemetryEvent['name']

/**
 * 事件名允许的谓词，也就是 `<主体>_<谓词>` 里的最后一段。**这不是装饰性的清单**：
 *
 * - 每个名字都必须以表里的一项结尾（`telemetry.test.ts` 逐个比对）；
 * - 表里的每一项都必须至少被一个名字用上——加一个词却不用事件去用，读的人只会以为漏了东西；
 * - 一个意思只能用这个词：要表达「新建了某个东西」时，答案永远是 `created`，
 *   不要再造一个 `added` / `registered` / `imported` 来和它并存。
 *
 * 表外的动词要先加这里、再加事件，两者必须同一次改动。每项的含义见上面的命名规则表。
 */
export const TELEMETRY_EVENT_PREDICATES = [
  'started',
  'finished',
  'failed',
  'completed',
  'created',
  'changed',
  'tested',
  'executed',
  'used',
  'happened',
] as const

/** 全部事件名。与 schema 同源，不是另抄一份名单。 */
export const TELEMETRY_EVENT_NAMES = TelemetryEventSchema.options
  .map(option => option.shape.name.value) as TelemetryEventName[]

/**
 * 写事件的人要提供的东西：只有事件名与它自己的属性。
 *
 * 信封字段（标识、时间、版本、平台）由上报器统一补，写业务的人碰不到它们——
 * 少一个可以填错的地方。`DistributiveOmit` 是必要的：直接用 `Omit` 会把联合类型
 * 压成一个共有的属性集，判别联合的窄化就没了。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type TelemetryEventInput = DistributiveOmit<TelemetryEvent, (typeof TELEMETRY_ENVELOPE_FIELDS)[number]>

/** `.omit` 要的是 `{ key: true }`，不是名字数组；写在这里能让它跟着信封名单一起变。 */
const OMIT_ENVELOPE_FIELDS = {
  occurredAt: true,
  installId: true,
  version: true,
  os: true,
  arch: true,
  locale: true,
  runtime: true,
} as const satisfies Record<(typeof TELEMETRY_ENVELOPE_FIELDS)[number], true>

/**
 * `TelemetryEventInput` 的运行期对应物：与事件联合**同源**，只是不含信封字段。
 *
 * 存在的理由是边界。界面侧发生的事（走完引导、新建 Provider）要经管理接口交给 core 上报，
 * 那条接口收的是不可信输入，必须有校验；而校验的对象偏偏是「去掉信封字段之后」的形状。
 * 派生而不是另抄一份，是为了让「新增一个事件」只改上面那一处。
 *
 * 两个写法上的让步，都只是类型系统的形状问题，不影响运行期：
 * - 回调参数标注成宽的 `ZodObject<ZodRawShape>`：`options` 的元素是十二项联合，
 *   直接 `.omit` 会因为「联合的签名互不兼容」而不通过（联合不整体可调用）；
 * - 前两项单独拆出来再展开剩余项：`z.union` 的签名要求「首个元素 + 第二项 + 其余」，
 *   而 `.map` 的返回值在类型上是数组，直接展开满足不了那个元组形状。
 */
const EVENT_INPUT_OPTIONS = TelemetryEventSchema.options.map((option: z.ZodObject<z.ZodRawShape>) =>
  option.omit(OMIT_ENVELOPE_FIELDS),
)
const [firstEventInputSchema, secondEventInputSchema, ...restEventInputSchemas] = EVENT_INPUT_OPTIONS
/**
 * 不导出：写入侧的校验入口是下面的解析器。多一个导出就多一个可以绕过断言、
 * 直接拿到退化输出类型的口子，而契约层的价值正在于「只有一个说法」。
 */
const TelemetryEventInputSchema = z.union([
  firstEventInputSchema,
  secondEventInputSchema,
  ...restEventInputSchemas,
])

/**
 * 校验一份「写入方视角」的事件；不是合法的事件就返回 `null`。
 *
 * 里面那处断言是**类型系统的补丁，不是运行期的放宽**：`.omit(Omit<ZodRawShape, …>)` 推算出来的
 * 输出类型会退化成 `{ [x: string]: any }`（因为 Omit 掉几个键之后 shape 只剩索引签名），
 * 而校验通过的值在运行期确实是 `TelemetryEventInput`——它就是同一份联合去掉公共字段。
 * 断言写在这里而不是调用点，是为了让「为什么可以断言」和 schema 待在同一屏。
 */
export function parseTelemetryEventInput(value: unknown): TelemetryEventInput | null {
  const result = TelemetryEventInputSchema.safeParse(value)
  return result.success ? (result.data as TelemetryEventInput) : null
}

// ========== 请求体 ==========

/**
 * 上报请求体：一批事件。
 *
 * 只有一项，而且它是一个数组：**批次是传输单位，不是产品概念**。再多一层包装（一个 `meta`、
 * 一个 `schemaVersion`）都会让人以为里面有东西，而里面确实没有——信封已经在每条事件上了。
 */
export const TelemetryBatchSchema = z.object({
  events: z.array(TelemetryEventSchema).min(1).max(TELEMETRY_MAX_EVENTS_PER_BATCH),
}).strict()

export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>

// ========== 字段去向 ==========

/**
 * **契约不规定字段去向。** 哪个字段落在哪里是适配器的事，而它不需要在这里有一份声明：
 * 适配器接到的是已经校验过的事件，字段就那么多，怎么摆由它决定。
 *
 * 这里曾经有一份 `TELEMETRY_FIELD_TARGETS`，把每个信封字段钉到某家后端的某个概念上
 * （`client_id` / `user_properties` / `device`…）。它的问题不是写错了，而是**位置错了**：
 * 一份 vendor 的表格放在双方的公共契约里，等于让「换一个存储」变成一次契约变更。
 * 删掉它之后，换后端只写一个新的 sink 文件（见 `docs/product/telemetry.md` §6）。
 */

// ========== 预览 ==========

/**
 * 「预览即将发送的内容」的响应（telemetry.md §13：自查走管理接口，设置页不展示）。
 *
 * `events` 必须是**真实报文**，不是另写一份说明文案：
 * - 队列里有待发送的事件时，给的就是那一批（`source: 'queue'`）；
 * - 队列为空时（绝大多数时候都是），用当前信封造一条 `app_started`（`source: 'sample'`），
 *   调用方据此标注来源。两种来源走的是同一个序列化路径，所以预览到的字节与真正会发出去的
 *   字节是同一份东西。
 */
export interface TelemetryPreview {
  /** 设置里的开关值。 */
  enabled: boolean
  /**
   * 是否真的在跑。
   *
   * 与 `enabled` 分开的原因：开关开着但没上报有好几种可能（开发档、标识文件写不动、
   * 补丁版本不认识当前平台），那些都不该在界面上表现成「已开启」。
   */
  running: boolean
  /** 实际使用的端点：正式构建下是常量，开发档可能被 `telemetryEndpoint` 覆盖。 */
  endpoint: string
  /** 本机安装标识；不可用时为 `null`。它也是「拿这个去删我的数据」的凭据。 */
  installId: string | null
  events: TelemetryEvent[]
  source: 'queue' | 'sample'
}
