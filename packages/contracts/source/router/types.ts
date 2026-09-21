import type { Protocol, TransportKind } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'

/**
 * 节点类型的全集。
 *
 * 写成**运行期的数组**再派生出类型，是为了让需要枚举它的地方（上报契约的 `node_kind` 字段）
 * 直接用同一份清单，而不是各抄一遍：抄一份的代价是「画布上能建的节点，上报接口不认识」。
 * `(typeof …)[number]` 与原来的联合类型完全等价，消费方不受影响。
 */
export const WORKFLOW_NODE_KINDS = [
  'input',
  'control-input',
  'protocol-discovery',
  'condition',
  'model-select',
  'iteration',
  'script',
  'prompt',
  'note',
  'output',
] as const

export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number]

export type WorkflowProtocol = Protocol | 'unknown'

/**
 * 引擎认识的全部请求协议，`unknown`（没认出来）也是其中一条合法分支。
 *
 * 协议发现节点的端口、字段候选里的枚举、引擎的合法性判断都取自这一份，
 * 免得「画布上有这个端口、引擎却不认」这种两边各写一份列表的漂移。
 */
export const ALL_WORKFLOW_PROTOCOLS: WorkflowProtocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'unknown',
]

/**
 * 请求走的**传输形态**（一次对话在线上长什么样）词表定义在 `@common/schemas`
 * （`TransportKindSchema`），代理层与工作流层共用同一份 —— 这里不另立一套
 * 「工作流传输」枚举。
 *
 * 只有这一根轴：连接形态由端点地址的 scheme 表达（`wss://` 是 WebSocket），
 * 「客户端要不要增量」是同一档 `http-stream` 的线格式，不是另一档连接形态。
 */

/**
 * 可以新增到画布上的节点类型。
 * 输入 / 输出节点是固定节点，不允许新增，也不允许删除。
 */
export type AppendableKind = Extract<
  WorkflowNodeKind,
  | 'control-input'
  | 'protocol-discovery'
  | 'condition'
  | 'model-select'
  | 'iteration'
  | 'script'
  | 'prompt'
  | 'note'
>

/**
 * 字段类型。
 * `object` 用于「要判断对象内容」的场景（取键、判空、结构化比较）；
 * `unknown` 表示 schema 里推不出类型（数组元素、未定义字段、动态脚本产出），
 * 此时不限制操作符，语义完全交给运行时按实际取值决定 —— 也就是「按动态脚本那样处理」。
 */
export type SchemaValueType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'unknown'

/**
 * 通配投影后缀：`logicalModels[*].id` 表示「先把 `logicalModels` 展开成元素集合，
 * 再对每个元素取 `id`，最后拍平成一个数组」。
 * 引擎的路径解析器和字段候选列表共用这个后缀，避免两边写法漂移。
 */
export const PATH_WILDCARD_SUFFIX = '[*]'

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isTrue'
  | 'isFalse'
  | 'empty'
  | 'notEmpty'
  | 'exists'

export interface NodePosition {
  x: number
  y: number
}

export interface WorkflowNodeBase {
  id: string
  kind: WorkflowNodeKind
  name: string
  enabled: boolean
  description: string
  position: NodePosition
}

export type WorkflowSourcePort =
  | 'out'
  | 'body'
  | 'else'
  | WorkflowProtocol
  | (string & {})

export interface WorkflowEdge {
  id: string
  sourceNodeId: string
  sourcePort: WorkflowSourcePort
  targetNodeId: string
}

export interface WorkflowGraph {
  version: 1
  nodes: WorkflowNodeModel[]
  edges: WorkflowEdge[]
}

/**
 * 一次运行里可见的逻辑模型（运行时不缓存模型配置，只有 id / 名称 / 开关）。
 *
 * 主进程的 `LogicalModel` 天然满足这个形状（多出来的字段没人读），因此代理入口
 * 可以直接把 `listLogicalModels()` 的结果交进来。
 */
export interface RuntimeLogicalModel {
  id: string
  name: string
  enabled: boolean
}

/** 引擎内部沿用的旧名字，与 `RuntimeLogicalModel` 是同一个形状，只保留一处定义。 */
export type LogicalModelContext = RuntimeLogicalModel

/**
 * 归一化之后的原始请求。
 * 保持最小的请求形状：`headers` 是扁平的字符串字典，没有多值头一说
 * （同名头在代理入口处已按 `,` 合并）。
 */
export interface WorkflowRequestPayload {
  path?: string
  method?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  [key: string]: unknown
}

export interface RouteContext {
  request: WorkflowRequestPayload
  logicalModels: RuntimeLogicalModel[]
  metadata: Record<string, unknown>
  traceId: string
}

/**
 * 路由运行的入参。
 *
 * `protocol` / `transport` 是**调用方提供的确凿事实**：代理入口在匹配端点
 * 与读封装描述时就已经知道客户端用的是什么协议、这条对话是什么形态，
 * 让引擎再从请求头里猜一遍只会多一个可能猜错的来源。
 * 调用方不知道时留空，引擎照旧自行推演（渲染进程的测试运行就是这种情况）。
 */
export interface RouteContextInput {
  request: WorkflowRequestPayload
  /** 本次运行可见的逻辑模型；缺省时按内置默认逻辑模型处理 */
  logicalModels?: RuntimeLogicalModel[]
  metadata?: Record<string, unknown>
  /** 调用方已经确定的请求协议 */
  protocol?: WorkflowProtocol
  /** 调用方已经确定的客户端跳传输形态 */
  transport?: TransportKind
}

export interface RouteContextEnvelope {
  payload: Record<string, unknown>
  context: RouteContext
}

export interface InputNode extends WorkflowNodeBase {
  kind: 'input'
}

export type ControlInputKind = 'switch' | 'select'

export interface ControlInputOption {
  label: string
  value: string
}

export interface ControlInputItem {
  id: string
  key: string
  label: string
  kind: ControlInputKind
  enabled: boolean
  defaultValue: string | boolean
  options?: ControlInputOption[]
}

export interface ControlInputNode extends WorkflowNodeBase {
  kind: 'control-input'
  controls: ControlInputItem[]
}

export interface ProtocolDiscoveryNode extends WorkflowNodeBase {
  kind: 'protocol-discovery'
}

export type ConditionValueSource = 'literal' | 'field'

export interface ConditionRule {
  fieldPath: string
  valueType: SchemaValueType
  operator: ConditionOperator
  /** 比较值来源：`literal`（默认）用 `value` / `enumOptions`，`field` 读取 `valueFieldPath` 的实时取值 */
  valueSource?: ConditionValueSource
  /** `field` 来源的比较字段路径，例如 `logicalModels[*].id` */
  valueFieldPath?: string
  value?: string
  secondaryValue?: string
  enumOptions?: string[]
}

export type ConditionLogicalOperator = 'and' | 'or'

export interface ConditionCase {
  id: string
  name: string
  logicalOperator: ConditionLogicalOperator
  conditions: ConditionRule[]
}

export interface ConditionNode extends WorkflowNodeBase {
  kind: 'condition'
  cases: ConditionCase[]
}

/**
 * 逻辑模型选择节点的落点来源。
 * - `fixed`：使用配置好的固定逻辑模型列表；
 * - `variable`：把某个字段的取值直接当作逻辑模型 id（例如 `request.body.model`），
 *   取不到值时使用兜底逻辑模型。
 *
 * 这里刻意不内置「跟随请求模型」这类专用语义：请求模型直连由
 * 「条件（`request.body.model in logicalModels[*].id`） + 逻辑模型选择(变量) +
 * 逻辑模型选择(固定 default)」等基础节点组合表达。
 */
export type ModelSelectSource = 'fixed' | 'variable'

export interface ModelSelectNode extends WorkflowNodeBase {
  kind: 'model-select'
  source: ModelSelectSource
  /** `variable` 来源读取的字段路径，例如 `request.body.model` */
  variablePath: string
  /** 固定逻辑模型（`fixed` 来源使用） */
  modelIds: string[]
  /** 兜底逻辑模型（`variable` 取不到值时使用；为空表示不兜底） */
  fallbackModelIds: string[]
}

export interface ModelSelection {
  modelIds: string[]
  /** 是否由节点上的显式取值命中（变量取不到值而回落到兜底逻辑模型时为 `false`） */
  matched: boolean
  reason: string
}

/**
 * 迭代结果的汇总方式。
 * - `first`：首个非空的每轮结果即停止（「在数组里找第一个满足条件的元素」）；
 * - `last`：保留最后一次非空结果；
 * - `list`：收集全部非空结果；
 * - `count`：不做汇总，写回实际执行轮数。
 */
export type IterationCollectMode = 'first' | 'last' | 'list' | 'count'

/** 迭代作用域里对下游可见的固定字段（相对 `route.iteration`）。 */
export const ITERATION_SCOPE_FIELDS = ['item', 'index', 'key', 'total'] as const

/**
 * 遍历迭代节点。
 *
 * 控制流由边表达：`body` 是循环体入口，循环体最后一个节点用一条回边指回本节点
 * 表示「本轮结束」，`out` 是循环结束后继续往下走的出口。
 * 因此本节点只能手工拼出，不做隐式子图。
 */
export interface IterationNode extends WorkflowNodeBase {
  kind: 'iteration'
  /** 要遍历的字段路径；支持通配投影（`logicalModels[*].id`）。取到数组按元素遍历，取到对象按键值对遍历。 */
  sourcePath: string
  /** 每轮结束后从该路径读取本轮结果；读到空值（undefined / null / 空数组 / 空字符串）视为未命中 */
  collectPath: string
  /** 汇总方式 */
  collectMode: IterationCollectMode
  /**
   * 汇总结果写回的字段路径；`count` 模式写入轮数。
   * 留空（`''`）表示只判定命中、不写回，适合「循环体自己写落点、下游节点再兜底」的拼法：
   * 否则整轮没命中时会用空数组覆盖掉循环体已经写下的值。
   */
  resultPath: string
  /** 轮数上限（业务预算），与全局步骤预算相互独立 */
  maxIterations: number
}

/**
 * 脚本节点沙箱超时。
 * schema（编辑期输入的合法范围）与引擎（执行前再夹一次）共用同一组常量，避免两处漂移。
 */
export const SCRIPT_TIMEOUT_DEFAULT = 2_000
export const SCRIPT_TIMEOUT_LIMIT = 10_000

/** LLM 节点调用超时；上限放宽到 10 分钟，长提示词 / 慢上游也能跑完。 */
export const PROMPT_TIMEOUT_DEFAULT = 60_000
export const PROMPT_TIMEOUT_LIMIT = 600_000

/**
 * 脚本节点：在受控沙箱里执行一小段用户 JS，用「代码」补足节点类型覆盖不到的场景。
 *
 * 沙箱里可用：
 * - `payload`：本次运行 payload 的深拷贝（`request` / `logicalModels` / `route` 都能读到）；
 * - `get(path)`：按路径取值，支持 `a[*].b` 通配投影，与条件节点的字段路径同一套语义；
 * - `console.log / warn / error`：日志回传到 trace 详情。
 *
 * 没有 `require` / `import` / 网络 / 文件系统 / `eval`，超时即中断。
 * 脚本用 `return` 交回结果，由引擎写入 `resultPath`。
 */
export interface ScriptNode extends WorkflowNodeBase {
  kind: 'script'
  /** 用户 JS 源码；函数体形式，用 `return` 交回结果。 */
  code: string
  /** 结果写回路径（如 `route.scriptResult`），写回值类型未知，下游条件可用全部操作符。 */
  resultPath: string
  /** 沙箱执行超时（毫秒）。 */
  timeoutMilliseconds: number
}

/**
 * LLM 节点：用指定逻辑模型执行一段提示词，把模型回复写回 payload。
 *
 * 「指定逻辑模型」直接复用逻辑模型体系：选中的逻辑模型在服务端按它自己的
 * 上游配置（供应商、协议、密钥、故障转移）执行，因此提示词走的是和真实请求同一条通路。
 */
export interface PromptNode extends WorkflowNodeBase {
  kind: 'prompt'
  /** 执行提示词使用的逻辑模型 id */
  logicalModelId: string
  /** 系统提示词 */
  systemPrompt: string
  /** 用户提示词模板，支持 `${path}` 取值（如 `${route.iteration.item}`） */
  promptTemplate: string
  /** 回复文本写回路径 */
  resultPath: string
  /** 采样温度 */
  temperature: number
  /** 回复长度上限 */
  maxTokens: number
  /** 调用超时（毫秒） */
  timeoutMilliseconds: number
}

/** 出口节点：路由终点的信息聚合与返回控制。 */
export interface OutputNode extends WorkflowNodeBase {
  kind: 'output'
  includeTrace: boolean
  summaryLevel: 'brief' | 'detailed'
}

/**
 * 备注节点的画布尺寸（逻辑像素）。
 * 便签是纯画布产物，尺寸参与图快照，因此三处（默认值、面板重置、画布拖拽下限）
 * 共用这一组常量，避免各写一份后互相打架。
 */
export const NOTE_DEFAULT_WIDTH = 280

export const NOTE_DEFAULT_HEIGHT = 180

export const NOTE_MIN_WIDTH = 180

export const NOTE_MIN_HEIGHT = 120

/** 便签拖拽上限。便签是旁注而不是第二块画布，超过一屏就没有「一眼看全」的意义了。 */
export const NOTE_MAX_WIDTH = 900

export const NOTE_MAX_HEIGHT = 900

/** 备注节点尺寸。 */
export interface NoteNodeSize {
  width: number
  height: number
}

/**
 * 备注节点：只在画布上留一段说明文字，**不参与引擎执行**。
 *
 * 它没有端口、不产生字段、不会被遍历到：引擎遇到它直接沿 `out` 边跳过，
 * 因此可以放心把「这张图怎么用」写在图旁边，而不用担心改变路由行为。
 */
export interface NoteNode extends WorkflowNodeBase {
  kind: 'note'
  /** 便签正文，Markdown 渲染 */
  text: string
  /** 便签尺寸；缺省时按 `NOTE_DEFAULT_*` 展示 */
  size?: NoteNodeSize
}

export type WorkflowNodeModel =
  | InputNode
  | ControlInputNode
  | ProtocolDiscoveryNode
  | ConditionNode
  | ModelSelectNode
  | IterationNode
  | ScriptNode
  | PromptNode
  | NoteNode
  | OutputNode

/**
 * 脚本执行请求（引擎 → 调用方注入的能力）。
 *
 * 引擎不直接依赖任何运行时沙箱：`node:vm` 这类服务端模块由主进程注入，
 * 这样同一份引擎代码既能在渲染进程里做纯静态推演，也能在服务端真正执行。
 */
export interface ScriptInvocation {
  nodeId: string
  nodeName: string
  /** 用户源码（函数体） */
  code: string
  /** 超时上限（毫秒） */
  timeoutMilliseconds: number
  /** payload 深拷贝：脚本读到的数据与引擎的实时决策数据隔离 */
  payload: Record<string, unknown>
}

export interface ScriptInvocationResult {
  success: boolean
  /** 脚本 `return` 交回的值 */
  value?: unknown
  /** `console.log / warn / error` 收集到的日志 */
  logs: string[]
  error?: string
  durationMilliseconds: number
}

/** 提示词执行请求（引擎 → 调用方注入的能力）。 */
export interface PromptInvocation {
  nodeId: string
  nodeName: string
  logicalModelId: string
  systemPrompt: string
  prompt: string
  temperature: number
  maxTokens: number
  timeoutMilliseconds: number
  /** 当前请求协议，决定用哪种上游协议调用该逻辑模型 */
  protocol: WorkflowProtocol
}

export interface PromptInvocationResult {
  success: boolean
  /** 模型回复文本 */
  text: string
  /** 上游返回体（供 trace 详情排查） */
  raw?: unknown
  error?: string
  /** 实际命中的上游，便于确认提示词打到了哪个供应商模型 */
  target?: string
  durationMilliseconds: number
}

/**
 * 运行能力：需要外部资源（沙箱 / 网络）的节点由调用方注入实现。
 * 缺省时引擎照常跑完整张图，只是这些节点会以「运行环境未提供该能力」失败并记录 trace。
 */
export interface RunCapabilities {
  runScript?: (invocation: ScriptInvocation) => Promise<ScriptInvocationResult>
  runPrompt?: (invocation: PromptInvocation) => Promise<PromptInvocationResult>
}

/**
 * 引擎写入 payload 的 `route` 命名空间：路由决策 + 决策依据。
 *
 * 设计约定（见 `docs/product/route-design.md`）：
 * - `metadata` 里的内容归调用方所有，引擎只读不写；
 * - 决策结果（`modelIds`）与决策依据（协议、控制输入、迭代作用域）都放在 `route` 下；
 * - 过程性的调试数据（协议归一化结果、每个节点的判定明细）只进 trace，不进 payload；
 * - 不写派生冗余字段：请求模型直接读请求本身（`request.body.model`），
 *   「可用逻辑模型 id」由通配投影（`logicalModels[*].id`）现算，都不再各存一份副本。
 */
export interface RouteDecision {
  /** 本次运行的追踪 id */
  traceId: string
  /** 识别到的请求协议；未识别时为 `unknown` */
  protocol: WorkflowProtocol
  /** 客户端跳的传输形态；调用方给出，缺省时按请求头与请求体推演 */
  transport: TransportKind
  /** 最终落点逻辑模型；既没有命中也没有兜底时为空数组 */
  modelIds: string[]
  /** 是否走了兜底策略（变量取值没有命中，转而使用兜底逻辑模型） */
  fallback: boolean
  /** 控制输入节点注入的运行时取值 */
  controls: Record<string, unknown>
  /** 迭代作用域；从未进入过遍历迭代节点时不存在 */
  iteration?: RouteIterationScope
}

/**
 * 迭代作用域：遍历迭代节点在每一轮开始时写入的运行时取值。
 *
 * 只在循环体内可见（循环体节点通过回边仍算迭代节点的下游，
 * 因此字段推导会把 `route.iteration.*` 暴露给循环体内的条件节点）。
 * 退出循环后由迭代节点写回最终汇总结果，作用域字段保留最后一轮的投影。
 */
export interface RouteIterationScope {
  /** 当前轮的来源路径 */
  source: string
  /** 当前轮的元素（数组模式）或取值（对象模式） */
  item: unknown
  /** 数组下标；对象模式为键在 `Object.keys` 里的序号 */
  index: number
  /** 对象模式下当前键；数组模式为空字符串 */
  key: string
  /** 本轮来源的总条数 */
  total: number
}

export interface WorkflowTrace {
  nodeId: string
  nodeName: string
  kind: WorkflowNodeKind
  success: boolean
  message: string
  /**
   * 这一步**有没有真的执行节点**。缺省（`undefined`）就是执行过。
   *
   * 只有两种情况是 `false`，而它们都还留在轨迹里：
   *
   * 1. 节点被禁用、引擎跳过它继续往下走（`message` 是「节点禁用，跳过」）——路径走过了，
   *    但这条边上的逻辑一行都没跑；
   * 2. 图里没有输入节点时那条「初始化」占位（`nodeId` 是 `-`）——它根本不是图上的节点。
   *
   * 留在轨迹里是因为界面要把「为什么走到这里」讲清楚（跳过也是走向的一部分），而遥测要的是
   * 「节点用得怎么样」，那里只有执行过才算数（见 `@common/telemetry` 的 `workflow_node_executed`）。
   */
  executed?: boolean
  details?: Record<string, unknown>
}

export interface WorkflowRunResult {
  outputPayload: unknown
  protocol: WorkflowProtocol
  /** 决策结果，按产出它的节点 id 组织 */
  nodeOutputs: NodeOutputMap
  stopReason: 'output' | 'missing-next' | 'max-steps' | 'error'
  trace: WorkflowTrace[]
}

/**
 * 单个节点产出的一条输出数据。
 * 渲染时不展示 `nodeId`，而是查节点名称作为分组标题，因此这里的 `name`
 * 只负责「一条输出叫什么」——例如控制项标签、条件分支名、逻辑模型 id。
 */
export interface NodeOutput {
  name: string
  value: unknown
  /** 可选补充说明，例如「兜底」「未命中」 */
  note?: string
}

/** 节点 id → 该节点产出的输出列表（同一节点可以产出多条）。 */
export type NodeOutputMap = Record<string, NodeOutput[]>

export interface SchemaFieldDescriptor {
  path: string
  valueType: SchemaValueType
  sourceNodeId: string
  sourcePort: string
  enumOptions?: string[]
  /** 一句话说明这个字段是什么，用于面板里的候选列表补充解释。 */
  note?: string
}

export interface ConfigHints {
  fields: SchemaFieldDescriptor[]
  recommendedOperators: Record<SchemaValueType, ConditionOperator[]>
}

/** 全部操作符，顺序即面板里的展示顺序。 */
export const ALL_CONDITION_OPERATORS: ConditionOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'in',
  'notIn',
  'regex',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isTrue',
  'isFalse',
  'empty',
  'notEmpty',
  'exists',
]

export interface ConditionOperatorMeta {
  /** 中文名称：下拉选项与节点卡片都展示它，`equals` 这类标识符只作为次要信息。 */
  labelKey: UiCatalogKey
  /** 一句话判定语义的目录键，写在选项的第二行。 */
  descriptionKey: UiCatalogKey
}

/**
 * 操作符的名称与语义说明**目录键**。
 *
 * 说明文字必须与 `engine.ts` 的 `evaluateCondition` 保持一致：用户在这里读到什么，
 * 运行时就得怎么判定。这张表、`ALL_CONDITION_OPERATORS` 与 `schemas.ts` 的 zod enum
 * 三处必须同步，有单测兜住不漂移。
 */
export const CONDITION_OPERATOR_META: Record<ConditionOperator, ConditionOperatorMeta> = {
  equals: { labelKey: 'router.operator.equals.label', descriptionKey: 'router.operator.equals.description' },
  notEquals: { labelKey: 'router.operator.notEquals.label', descriptionKey: 'router.operator.notEquals.description' },
  contains: { labelKey: 'router.operator.contains.label', descriptionKey: 'router.operator.contains.description' },
  notContains: { labelKey: 'router.operator.notContains.label', descriptionKey: 'router.operator.notContains.description' },
  startsWith: { labelKey: 'router.operator.startsWith.label', descriptionKey: 'router.operator.startsWith.description' },
  endsWith: { labelKey: 'router.operator.endsWith.label', descriptionKey: 'router.operator.endsWith.description' },
  in: { labelKey: 'router.operator.in.label', descriptionKey: 'router.operator.in.description' },
  notIn: { labelKey: 'router.operator.notIn.label', descriptionKey: 'router.operator.notIn.description' },
  regex: { labelKey: 'router.operator.regex.label', descriptionKey: 'router.operator.regex.description' },
  gt: { labelKey: 'router.operator.gt.label', descriptionKey: 'router.operator.gt.description' },
  gte: { labelKey: 'router.operator.gte.label', descriptionKey: 'router.operator.gte.description' },
  lt: { labelKey: 'router.operator.lt.label', descriptionKey: 'router.operator.lt.description' },
  lte: { labelKey: 'router.operator.lte.label', descriptionKey: 'router.operator.lte.description' },
  between: { labelKey: 'router.operator.between.label', descriptionKey: 'router.operator.between.description' },
  isTrue: { labelKey: 'router.operator.isTrue.label', descriptionKey: 'router.operator.isTrue.description' },
  isFalse: { labelKey: 'router.operator.isFalse.label', descriptionKey: 'router.operator.isFalse.description' },
  empty: { labelKey: 'router.operator.empty.label', descriptionKey: 'router.operator.empty.description' },
  notEmpty: { labelKey: 'router.operator.notEmpty.label', descriptionKey: 'router.operator.notEmpty.description' },
  exists: { labelKey: 'router.operator.exists.label', descriptionKey: 'router.operator.exists.description' },
}

/** 未知操作符（旧数据）的兜底文案：不隐藏字段，但明确标出无法识别。 */
const UNKNOWN_OPERATOR_META: ConditionOperatorMeta = { labelKey: 'router.operator.unknown.label', descriptionKey: 'router.operator.unknown.description' }

/** 取操作符的名称与说明目录键；未知标识符退化成兜底文案，避免旧数据把界面打崩。 */
export function conditionOperatorMeta(operator: ConditionOperator): ConditionOperatorMeta {
  return CONDITION_OPERATOR_META[operator] ?? UNKNOWN_OPERATOR_META
}

export const DEFAULT_OPERATOR_SET: Record<SchemaValueType, ConditionOperator[]> = {
  string: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'regex', 'empty', 'notEmpty', 'exists'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'],
  boolean: ['isTrue', 'isFalse', 'equals', 'notEquals', 'exists'],
  enum: ['equals', 'notEquals', 'in', 'notIn', 'exists'],
  array: ['contains', 'notContains', 'empty', 'notEmpty', 'exists'],
  object: ['contains', 'notContains', 'equals', 'notEquals', 'empty', 'notEmpty', 'exists'],
  // 类型未知时不收窄操作符：判定语义交给运行时，与动态脚本的处理方式一致。
  unknown: [...ALL_CONDITION_OPERATORS],
}

/**
 * 支持「比较值来自另一个字段」的操作符。
 * 例如 `request.body.model in logicalModels[*].id` —— 通用的成员判定，
 * 不需要引擎为某个具体场景预先算好布尔结果。
 */
export const FIELD_OPERAND_OPERATORS: ConditionOperator[] = ['equals', 'notEquals', 'in', 'notIn', 'contains', 'notContains']

/**
 * 已保存的路由图版本摘要。
 *
 * 版本列表只带摘要不带图：一张图有几十个节点，列 30 个版本会把列表接口撑成几百 KB，
 * 而列表里真正要显示的只有「第几版 / 什么时候 / 几个节点」。
 */
export interface RouterGraphVersionSummary {
  /** 单调递增的版本号（v1、v2 …），也就是「恢复这个版本」时要传的号 */
  version: number
  /** 用户给这一版起的名字；没起名时是空字符串（版本的身份是 `version`，不需要唯一的名字） */
  name: string
  /** 这次保存给版本写的说明；没写时是空字符串 */
  description: string
  /** 保存时间（epoch 毫秒） */
  savedAt: number
  /** 该版本的节点数量，用于列表摘要 */
  nodeCount: number
}

/**
 * 「一版都没保存过」占用的版本号。
 *
 * 读当前生效的图时用它表示这份图是内建默认策略，不来自任何已保存版本（真实版本号从 1 开始）；
 * 因此拿到它不能去读历史版本，也不能把这张图当成「用户存下来的」。
 */
export const UNSAVED_ROUTER_GRAPH_VERSION = 0

/** 当前生效的路由图：代理运行时读的就是这一份（一版都没保存过时是内建默认策略）。 */
export interface RouterGraphSnapshot {
  graph: WorkflowGraph
  /** 版本号；内建默认策略固定为 `UNSAVED_ROUTER_GRAPH_VERSION` */
  version: number
  /** 保存时间（epoch 毫秒）；内建默认策略（版本号 0）没有保存时间，为 0 */
  savedAt: number
}

/** 保存的结果；内容与最新版本一致时 `created` 为假、版本号沿用最新那个。 */
export interface RouterGraphSaveResult extends RouterGraphVersionSummary {
  created: boolean
}
