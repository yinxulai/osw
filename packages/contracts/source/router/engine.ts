import { ALL_TRANSPORT_KINDS, type TransportKind } from '@common/schemas'
import { requestBodyField, type RequestBodyFieldRole } from './request-shape'
import {
  ALL_WORKFLOW_PROTOCOLS,
  PATH_WILDCARD_SUFFIX,
  PROMPT_TIMEOUT_LIMIT,
  SCRIPT_TIMEOUT_LIMIT,
  type ConditionCase,
  type ConditionLogicalOperator,
  type ConditionOperator,
  type ConditionRule,
  type ControlInputNode,
  type IterationNode,
  type ModelSelection,
  type ModelSelectNode,
  type NodeOutputMap,
  type PromptInvocationResult,
  type ProtocolDiscoveryNode,
  type RouteContext,
  type RouteContextEnvelope,
  type RouteContextInput,
  type RouteDecision,
  type RouteIterationScope,
  type RunCapabilities,
  type RuntimeLogicalModel,
  type ScriptInvocationResult,
  type WorkflowRequestPayload,
  type WorkflowGraph,
  type WorkflowProtocol,
  type WorkflowRunResult,
  type WorkflowTrace,
} from './types'

/**
 * trace 的 `message` / `reason` / 节点输出名是**运行记录**而不是界面文案：
 * 它们会写进 `route` 决策命名空间并随请求落库，语言切换后历史记录不会（也不该）跟着变。
 * 因此这里保留中文源码字面量、不进 UI 目录——与预设图数据同属「生成内容」。
 * 界面侧只对节点名称这类用户数据做原样展示。
 */

export interface WorkflowRunOptions {
  /**
   * 需要外部资源（沙箱 / 网络）的节点由调用方注入实现。
   * 缺省时引擎照常跑完整张图，命中这些节点时记录 `success: false` 的 trace。
   */
  capabilities?: RunCapabilities
}

const MAX_STEPS = 2000

function generateTraceId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `trace-${Date.now()}-${random}`
}

function clonePayload<T>(payload: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as T
}

/**
 * 路径段：`a[*].b` 拆成 `[{ key: 'a', wildcard: true }, { key: 'b' }]`。
 * 通配段表示「读 key 之后，对数组每一项继续解析剩下的路径，最后拍平一层」，
 * 例如 `logicalModels[*].id` 取到的是全部逻辑模型 id 组成的字符串数组。
 */
interface PathSegment {
  key: string
  wildcard: boolean
}

function parsePath(path: string): PathSegment[] {
  return path
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      if (!segment.endsWith(PATH_WILDCARD_SUFFIX)) return { key: segment, wildcard: false }
      return { key: segment.slice(0, -PATH_WILDCARD_SUFFIX.length), wildcard: true }
    })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveSegments(current: unknown, segments: PathSegment[], index: number): unknown {
  if (!isPlainObject(current)) return undefined
  const segment = segments[index]
  if (!(segment.key in current)) return undefined

  const value = current[segment.key]
  const remaining = index + 1
  if (!segment.wildcard) {
    return remaining >= segments.length ? value : resolveSegments(value, segments, remaining)
  }

  if (!Array.isArray(value)) return undefined
  if (remaining >= segments.length) return value

  const projected: unknown[] = []
  for (const item of value) {
    const resolved = resolveSegments(item, segments, remaining)
    if (resolved === undefined) continue
    // 拍平一层：内层再取到数组时直接展开，避免出现「数组的数组」。
    if (Array.isArray(resolved)) projected.push(...resolved)
    else projected.push(resolved)
  }
  return projected
}

/** 按路径取值，支持 `a[*].b` 通配投影；路径不存在时返回 `undefined`。 */
export function getByPath(payload: unknown, path: string): unknown {
  const segments = parsePath(path)
  if (!segments.length) return undefined
  return resolveSegments(payload, segments, 0)
}

/** 按路径写值；中间缺失的对象会被就地创建，数组段不支持写入。 */
function setByPath(payload: unknown, path: string, value: unknown): boolean {
  const segments = parsePath(path)
  if (!segments.length || segments.some(segment => segment.wildcard)) return false

  let current: Record<string, unknown> | undefined
  if (isPlainObject(payload)) current = payload

  for (let index = 0; current && index < segments.length - 1; index += 1) {
    const key = segments[index].key
    const next = current[key]
    if (isPlainObject(next)) {
      current = next
      continue
    }
    const created: Record<string, unknown> = {}
    current[key] = created
    current = created
  }

  if (!current) return false
  current[segments[segments.length - 1].key] = value
  return true
}

function createEmptyRoute(): RouteDecision {
  return {
    traceId: '',
    protocol: 'unknown',
    transport: 'http',
    modelIds: [],
    fallback: false,
    controls: {},
  }
}

/** 取对象字段；不存在或类型不对时原地建一个空对象。 */
function objectField(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = container[key]
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const created: Record<string, unknown> = {}
  container[key] = created
  return created
}

/** 读取 payload 上的 `route` 决策命名空间（由 `normalizeInputPayload` 建好）。 */
function routeOf(payload: Record<string, unknown>): RouteDecision {
  return objectField(payload, 'route') as unknown as RouteDecision
}

/** 归一化逻辑模型列表：运行时会传入主进程的逻辑模型（id / 名称 / 开关）。 */
function readLogicalModels(source: unknown): RuntimeLogicalModel[] {
  if (!Array.isArray(source)) return []
  return source
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const model = item as Record<string, unknown>
      return {
        id: String(model.id ?? '').trim(),
        name: String(model.name ?? '').trim(),
        enabled: Boolean(model.enabled),
      }
    })
    .filter(model => model.id && model.name)
}

function normalizeInputPayload(inputPayload: unknown): RouteContextEnvelope {
  const normalized = (inputPayload && typeof inputPayload === 'object' ? clonePayload(inputPayload) : {}) as Record<string, unknown>

  const request = (normalized.request && typeof normalized.request === 'object'
    ? normalized.request
    : {}) as WorkflowRequestPayload

  const metadata = (normalized.metadata && typeof normalized.metadata === 'object'
    ? normalized.metadata
    : {}) as Record<string, unknown>

  const logicalModels = readLogicalModels(normalized.logicalModels)

  const traceId = typeof metadata.traceId === 'string' && metadata.traceId.trim() ? metadata.traceId : generateTraceId()

  /**
   * `metadata` 归调用方所有：引擎只读不写。
   * 路由自己产生的数据（决策 + 决策依据）统一写在 `route` 命名空间下，
   * 过程性数据（协议归一化结果、节点判定明细）只进 trace。
   *
   * 不写派生冗余字段：
   * - 「请求模型」就是请求自己的字段（`request.body.model`，写在哪由协议决定），
   *   再存一份副本只会多出第二个事实源；入口节点也不报它 —— 要它就问协议发现节点；
   * - 「可用逻辑模型 id」是 `logicalModels` 的投影，需要时用通配投影（`logicalModels[*].id`）现算。
   */
  normalized.route = {
    ...createEmptyRoute(),
    traceId,
    protocol: readKnownProtocol(normalized),
    transport: readKnownTransport(normalized),
    controls: objectField(normalized, 'controls'),
  } satisfies RouteDecision

  const context: RouteContext = {
    request,
    logicalModels,
    metadata,
    traceId,
  }

  normalized.request = request
  normalized.logicalModels = logicalModels
  normalized.metadata = metadata

  return {
    payload: normalized,
    context,
  }
}

/** 头部值统一成字符串（`headers` 只支持单值，数组仅为容错）。 */
function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).join(',')
  }
  if (typeof value === 'string') return value
  return ''
}

function getHeader(headers: Record<string, unknown>, name: string): string {
  return normalizeHeaderValue(findHeaderValue(headers, name))
}

/**
 * 按头名大小写不敏感取值。
 *
 * 全仓读请求头只走这里（`getHeader` 与条件字段解析都是它的包装）：
 * 「头名大小写不敏感」是 HTTP 的规矩，写两遍迟早只改一处。
 * 头不存在时返回 `undefined`，与「头是空的」区分开。
 */
function findHeaderValue(headers: Record<string, unknown>, name: string): unknown {
  const lowered = name.trim().toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowered) return value
  }
  return undefined
}

/**
 * 本次请求在**客户端跳**的传输形态。
 *
 * 优先采用调用方给出的事实（代理入口从接口的封装描述里读到），只有在调用方没说的时候
 * 才按请求头与请求体推演（渲染进程的测试运行就是这样）。
 */
function readKnownTransport(payload: Record<string, unknown>): TransportKind {
  const declared = payload.transport
  return isTransportKind(declared) ? declared : detectTransport(payload)
}

/** 本次请求的协议。同样优先采用调用方给出的事实，否则交给协议发现节点现场推演。 */
function readKnownProtocol(payload: Record<string, unknown>): WorkflowProtocol {
  const declared = payload.protocol
  return isWorkflowProtocol(declared) ? declared : 'unknown'
}

function isTransportKind(value: unknown): value is TransportKind {
  return ALL_TRANSPORT_KINDS.some(transport => transport === value)
}

function isWorkflowProtocol(value: unknown): value is WorkflowProtocol {
  return ALL_WORKFLOW_PROTOCOLS.some(protocol => protocol === value)
}

/** 取请求头字典；不是对象时给空对象，调用方不必各自兜底。 */
function readRequestHeaders(payload: Record<string, unknown>): Record<string, unknown> {
  const headersValue = getByPath(payload, 'request.headers')
  return headersValue && typeof headersValue === 'object'
    ? (headersValue as Record<string, unknown>)
    : {}
}

/**
 * 从请求头与请求体推演传输形态。
 *
 * `upgrade: websocket` 是唯一的 WebSocket 信号；否则看客户端有没有表达「边收边发」的意思
 * （`accept` / `content-type` / `body.stream` 三个信号命中一个即成立 —— 客户端不保证三样都写，
 * 而这三样都只说明同一件事）。都没有就是整包的一问一答。
 */
function detectTransport(payload: Record<string, unknown>): TransportKind {
  const headers = readRequestHeaders(payload)
  if (getHeader(headers, 'upgrade').toLowerCase().includes('websocket')) return 'websocket'
  const accept = getHeader(headers, 'accept').toLowerCase()
  const contentType = getHeader(headers, 'content-type').toLowerCase()
  const stream = getByPath(payload, 'request.body.stream')
  if (accept.includes('text/event-stream') || contentType.includes('text/event-stream') || stream === true) {
    return 'http-stream'
  }
  return 'http'
}

function resolveProtocolTarget(edges: Map<string, string>, nodeId: string, protocol: WorkflowProtocol): string | undefined {
  return edgeTarget(edges, nodeId, protocol)
}

function applyControlInputs(payload: Record<string, unknown>, node: ControlInputNode): void {
  const controls = objectField(routeOf(payload) as unknown as Record<string, unknown>, 'controls')

  for (const control of node.controls) {
    if (!control.enabled) continue
    controls[control.key] = control.defaultValue
  }
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function splitSet(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * 比较值来源：`literal` 直接用规则上的字面量，`field` 读取 `valueFieldPath` 的实时取值。
 * 有了字段来源，「某字段的取值是否落在另一个列表字段里」就能用通用条件表达，
 * 不需要引擎为具体场景预计算布尔结果。
 */
function resolveFieldOperand(rule: ConditionRule, payload: Record<string, unknown>): unknown {
  if (rule.valueSource !== 'field') return undefined
  const path = (rule.valueFieldPath ?? '').trim()
  return path ? getByPath(payload, path) : undefined
}

/** `in` / `notIn` 的比较集合：字面量按逗号拆分，字段来源按数组 / 标量展开。 */
function resolveExpectedSet(rule: ConditionRule, payload: Record<string, unknown>): string[] {
  if (rule.valueSource === 'field') {
    const resolved = resolveFieldOperand(rule, payload)
    if (Array.isArray(resolved)) return resolved.map(item => String(item)).filter(Boolean)
    if (resolved === undefined || resolved === null) return []
    return [String(resolved)]
  }

  if (rule.valueType === 'enum' && rule.enumOptions?.length) return rule.enumOptions
  return splitSet(rule.value)
}

/** 其余操作符的比较值：统一成字符串（字段来源取到数组时按逗号连接）。 */
function resolveExpectedText(rule: ConditionRule, payload: Record<string, unknown>): string {
  if (rule.valueSource === 'field') {
    const resolved = resolveFieldOperand(rule, payload)
    if (resolved === undefined || resolved === null) return ''
    return Array.isArray(resolved) ? resolved.map(item => String(item)).join(',') : String(resolved)
  }

  return rule.value ?? ''
}

/** 对象 / 数组的结构化序列化；失败（循环引用等）时返回 null。 */
function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null
  } catch {
    return null
  }
}

/**
 * 判空：类型感知，对象看有没有键、数组看长度、字符串看去掉空白后是否为空。
 * 「判断对象或者数组内容」的场景全靠这里，不再退化成 `String(value)` 比较。
 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  if (isPlainObject(value)) return Object.keys(value).length === 0
  if (typeof value === 'string') return value.trim() === ''
  return false
}

/** 条件字段里「请求头」的路径前缀：这一段之后的名字按头名大小写不敏感解析。 */
const HEADER_FIELD_PREFIX = 'request.headers.'

/**
 * 解析条件字段的**运行时取值**。
 *
 * 与 `getByPath` 只差一处：`request.headers.<名字>` 按头名**大小写不敏感**解析。
 * HTTP 头名本来就大小写不敏感（`User-Agent` 与 `user-agent` 是同一个头），而 `getByPath`
 * 是精确的键匹配 —— 照文档写 `request.headers.user-agent`、客户端发来 `User-Agent` 就读成
 * 「字段不存在」，那是引擎替 RFC 说错话。
 * 头不存在时返回 `undefined`（而不是空串）：`exists` / `empty` 因此仍能如实区分
 * 「没这个头」与「头是空的」。
 *
 * 头名允许带 `.`（如 `x.feishu-request-id`），所以前缀之后的整段都算头名，不再按路径分段 ——
 * 头值只可能是字符串，不存在「再往下读一层」的情形。
 */
export function resolveConditionField(payload: Record<string, unknown>, fieldPath: string): unknown {
  if (!fieldPath.startsWith(HEADER_FIELD_PREFIX)) return getByPath(payload, fieldPath)

  const name = fieldPath.slice(HEADER_FIELD_PREFIX.length).trim()
  const headers = getByPath(payload, 'request.headers')
  if (!name || !isPlainObject(headers)) return undefined

  const value = findHeaderValue(headers, name)
  return value === undefined ? undefined : normalizeHeaderValue(value)
}

/** 一条条件的判定明细：`actual` 是运行时读到的值，供「为什么命中」核对。 */
export interface ConditionRuleEvaluation {
  fieldPath: string
  operator: ConditionOperator
  actual: unknown
  matched: boolean
}

/** 一组条件的判定结果：布尔结论 + 逐条明细。 */
export interface ConditionGroupEvaluation {
  matched: boolean
  conditions: ConditionRuleEvaluation[]
}

/**
 * 判定一组条件的**唯一入口**：图的条件分支与规则表都走这里。
 *
 * 逐条明细一并回传：规则表的测试运行要能回答「为什么是这条」，只给一个布尔值没法解释；
 * 图侧的条件分支只看 `matched`，多出来的明细它不用。
 * 同一个条件在两种模式里因此不可能有第二种判定。
 */
export function evaluateConditionGroup(conditions: ConditionRule[], logicalOperator: ConditionLogicalOperator, payload: Record<string, unknown>): ConditionGroupEvaluation {
  const evaluations = conditions.map(rule => {
    const actual = resolveConditionField(payload, rule.fieldPath)
    return { fieldPath: rule.fieldPath, operator: rule.operator, actual, matched: evaluateCondition(rule, actual, payload) }
  })
  return {
    matched: logicalOperator === 'and'
      ? evaluations.every(item => item.matched)
      : evaluations.some(item => item.matched),
    conditions: evaluations,
  }
}

/**
 * 包含判定：
 * - 数组：比较每个元素（对象元素按结构化序列化比较）；
 * - 对象：比较键名；
 * - 其余（含 `unknown` 取到的标量）：退化成子串包含。
 */
function containsValue(actual: unknown, expected: string): boolean {
  if (Array.isArray(actual)) {
    return actual.some(item => String(item) === expected || safeStringify(item) === expected)
  }
  if (isPlainObject(actual)) return Object.keys(actual).includes(expected)
  return String(actual ?? '').includes(expected)
}

/** 相等判定：对象 / 数组按结构化序列化比较，同时兼容「数组按逗号连接后比较」。 */
function equalsValue(actual: unknown, expected: string): boolean {
  if (Array.isArray(actual) || isPlainObject(actual)) {
    const serialized = safeStringify(actual)
    if (serialized !== null && serialized === expected.trim()) return true
  }
  return String(actual ?? '') === expected
}

function evaluateCondition(rule: ConditionRule, actual: unknown, payload: Record<string, unknown>): boolean {
  const operator: ConditionOperator = rule.operator
  const expected = resolveExpectedText(rule, payload)

  if (operator === 'exists') {
    return actual !== undefined && actual !== null
  }

  if (operator === 'empty') {
    return isEmptyValue(actual)
  }

  if (operator === 'notEmpty') {
    return !isEmptyValue(actual)
  }

  if (operator === 'isTrue') {
    return actual === true
  }

  if (operator === 'isFalse') {
    return actual === false
  }

  if (operator === 'regex') {
    try {
      return new RegExp(expected).test(String(actual ?? ''))
    } catch {
      return false
    }
  }

  if (operator === 'contains') {
    return containsValue(actual, expected)
  }

  if (operator === 'notContains') {
    return !containsValue(actual, expected)
  }

  if (operator === 'startsWith') {
    return String(actual ?? '').startsWith(expected)
  }

  if (operator === 'endsWith') {
    return String(actual ?? '').endsWith(expected)
  }

  if (operator === 'in' || operator === 'notIn') {
    const items = resolveExpectedSet(rule, payload)
    const included = items.includes(String(actual ?? ''))
    return operator === 'in' ? included : !included
  }

  if (operator === 'between') {
    const lower = parseNumber(expected)
    const upper = parseNumber(rule.secondaryValue)
    const current = Number(actual)
    if (!Number.isFinite(current) || lower === null || upper === null) {
      return false
    }
    return current >= lower && current <= upper
  }

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    const current = Number(actual)
    const expectedNumber = parseNumber(expected)
    if (!Number.isFinite(current) || expectedNumber === null) {
      return false
    }

    if (operator === 'gt') return current > expectedNumber
    if (operator === 'gte') return current >= expectedNumber
    if (operator === 'lt') return current < expectedNumber
    return current <= expectedNumber
  }

  if (operator === 'equals') return equalsValue(actual, expected)
  if (operator === 'notEquals') return !equalsValue(actual, expected)
  return false
}

function evaluateCase(caseNode: ConditionCase, payload: Record<string, unknown>): boolean {
  return evaluateConditionGroup(caseNode.conditions, caseNode.logicalOperator, payload).matched
}

function discoverProtocol(_node: ProtocolDiscoveryNode, payload: Record<string, unknown>): {
  protocol: WorkflowProtocol
  transport: TransportKind
  reason: string
} {
  const transport = readKnownTransport(payload)
  /**
   * 传输形态是调用方给出的事实时直接采信，只在 reason 里说清楚依据。
   * 它不是「被发现的」，而是随请求一起进来的确凿事实 —— 协议才需要猜，
   * 客户端跳的形态在入口处就已经知道了。
   */
  const settled = (protocol: WorkflowProtocol, reason: string) => ({ protocol, transport, reason })

  /**
   * 调用方已经确定协议时不再猜：代理入口在匹配 `(方法, 路径)` 时就定下了协议，
   * 它比任何基于路径形状与请求头的猜测都准。猜的那一套只在调用方没说的时候用
   * （渲染进程的测试运行就是这样）。
   */
  const declared = readKnownProtocol(payload)
  if (declared !== 'unknown') {
    return settled(declared, `调用方已确定协议为 ${declared}，形态 ${transport}`)
  }

  const path = String(getByPath(payload, 'request.path') ?? '').toLowerCase()
  const headers = readRequestHeaders(payload)

  // 走到这里说明调用方没给协议，只能靠形状猜：此刻**一条声明都没有**，
  // 所以这里允许直接看原始请求体。协议一旦定下，读体就一律走声明表（`requestBodyField`）。
  const providerHeader = getHeader(headers, 'x-provider').toLowerCase()
  const modelId = String(getByPath(payload, 'request.body.model') ?? '').toLowerCase()

  if (providerHeader.includes('openai') || path.includes('/chat/completions')) {
    return settled('openai-completions', `根据 header/path 判定为 openai-completions，形态 ${transport}`)
  }

  if (path.includes('/responses')) {
    return settled('openai-responses', `根据 path 判定为 openai-responses，形态 ${transport}`)
  }

  if (providerHeader.includes('anthropic') || path.includes('/messages') || modelId.includes('claude')) {
    return settled('anthropic-messages', `根据 header/path/model 判定为 anthropic-messages，形态 ${transport}`)
  }

  return settled('unknown', `自动识别未命中，归类 unknown，形态 ${transport}`)
}

function normalizeProtocolMessageContent(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.map(item => typeof item === 'string' ? item : (item && typeof item === 'object' ? item : String(item ?? '')))
  }
  if (content === undefined || content === null) return ''
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') return content
  return JSON.stringify(content)
}

function normalizeProtocolMessages(candidate: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(candidate)) return []

  return candidate.map((item) => {
    if (!item || typeof item !== 'object') {
      return { role: 'user', content: String(item ?? '') }
    }

    const record = item as Record<string, unknown>
    const role = typeof record.role === 'string' ? record.role : 'user'
    const content = 'content' in record ? record.content : ('text' in record ? record.text : '')

    return {
      ...record,
      role,
      content: normalizeProtocolMessageContent(content),
    }
  })
}

/**
 * 协议发现节点的归一化视图：这次请求按**命中的协议**解析出来的那一层。
 *
 * 模型名与消息列表的路径都取自声明表（`requestBodyField`），不在这里再写一遍
 *「先找 messages、找不到找 input」—— 那是声明表的第二份副本，换个协议就静默跑偏。
 * 认不出协议时什么都没有声明，这里就如实给空值，不退回「按某一种协议猜」。
 *
 * 这份视图只进 trace，不写回 payload（它是解析过程的产物，不是一手事实）。
 */
function buildNormalizedProtocolOutput(protocol: WorkflowProtocol, transport: TransportKind, payload: Record<string, unknown>): Record<string, unknown> {
  const model = readDeclaredField(payload, protocol, 'model')

  return {
    protocol,
    transport,
    model: typeof model === 'string' ? model : '',
    messages: normalizeProtocolMessages(readDeclaredField(payload, protocol, 'messages')),
    raw: (getByPath(payload, 'request.body') ?? {}) as Record<string, unknown>,
  }
}

/** 按声明表读某个角色的字段取值；这个协议没声明该角色时返回 `undefined`。 */
function readDeclaredField(payload: Record<string, unknown>, protocol: WorkflowProtocol, role: RequestBodyFieldRole): unknown {
  const field = requestBodyField(protocol, role)
  return field ? getByPath(payload, field.path) : undefined
}

/**
 * 记录协议发现的结论。
 * `route.protocol` / `route.transport` 是决策依据，写进 payload；
 * 归一化后的请求体只是解析过程的产物，仅作为返回值交给 trace 详情。
 */
function writeRouteProtocol(payload: Record<string, unknown>, protocol: WorkflowProtocol, transport: TransportKind): Record<string, unknown> {
  const route = routeOf(payload)
  route.protocol = protocol
  route.transport = transport

  return buildNormalizedProtocolOutput(protocol, transport, payload)
}

/**
 * 给某个节点登记一条输出数据。
 * 结果按节点 id 聚合，渲染侧再查节点名称作为分组标题，
 * 因此同一节点可以登记任意多条（控制项、条件分支、落点…）。
 */
function addNodeOutput(outputs: NodeOutputMap, nodeId: string, name: string, value: unknown, note?: string): void {
  const list = outputs[nodeId] ?? []
  list.push(note ? { name, value, note } : { name, value })
  outputs[nodeId] = list
}

export function normalizeModelIds(modelIds: string[]): string[] {
  return [...new Set(modelIds.map(id => id.trim()).filter(Boolean))]
}

/** 变量取值 → 逻辑模型 id 列表。字段可以是单个 id（字符串），也可以是 id 列表（字符串数组）。 */
export function readModelIdsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeModelIds(value.map(item => String(item)))
  if (typeof value === 'string') return normalizeModelIds([value])
  return []
}

/**
 * 解析逻辑模型选择节点的落点。
 * - `fixed`：直接使用节点上配置的固定逻辑模型列表；
 * - `variable`：把 `variablePath` 指向的字段取值当作逻辑模型 id，取不到值时使用兜底列表
 *   （兜底列表为空表示不兜底，此时落点为空，由输出节点报「没有可用逻辑模型」）。
 */
function resolveModelSelection(node: ModelSelectNode, payload: Record<string, unknown>): ModelSelection {
  if (node.source === 'variable') {
    const variablePath = node.variablePath.trim()
    const modelIds = variablePath ? readModelIdsFromValue(getByPath(payload, variablePath)) : []
    if (modelIds.length > 0) {
      return {
        modelIds,
        matched: true,
        reason: `字段 ${variablePath} 取值 ${modelIds.join('、')}，直连该逻辑模型`,
      }
    }

    const fallbackModelIds = normalizeModelIds(node.fallbackModelIds)
    return {
      modelIds: fallbackModelIds,
      matched: false,
      reason: fallbackModelIds.length > 0
        ? `字段 ${variablePath || '（未配置）'} 没有可用的逻辑模型取值，回落到兜底逻辑模型 ${fallbackModelIds.join('、')}`
        : `字段 ${variablePath || '（未配置）'} 没有可用的逻辑模型取值，且未配置兜底逻辑模型`,
    }
  }

  const modelIds = normalizeModelIds(node.modelIds)
  return {
    modelIds,
    matched: modelIds.length > 0,
    reason: modelIds.length > 0 ? `选择 ${modelIds.length} 个指定逻辑模型` : '尚未选择任何逻辑模型',
  }
}

function buildMissingInputTrace(message: string): WorkflowTrace {
  // `executed: false`：这不是图上的节点，是一个「这次执行根本没起来」的占位（见 `WorkflowTrace.executed`）。
  return { nodeId: '-', nodeName: '初始化', kind: 'input', success: false, message, executed: false }
}

function edgeTarget(edges: Map<string, string>, nodeId: string, port = 'out'): string | undefined {
  return edges.get(`${nodeId}:${port}`)
}

/** 一轮迭代：对象模式下带键名，数组 / 标量模式下键名是下标或空串。 */
interface IterationEntry {
  key: string
  value: unknown
}

/**
 * 解析迭代来源。
 * 数组按元素遍历，对象按键值对遍历；标量当成「只有一项的集合」，
 * 这样把 `sourcePath` 指到单个对象或单值时不会静默不执行。
 */
function collectIterationItems(payload: Record<string, unknown>, sourcePath: string): IterationEntry[] {
  const raw = getByPath(payload, sourcePath.trim())
  if (Array.isArray(raw)) return raw.map((value, index) => ({ key: String(index), value }))
  if (isPlainObject(raw)) return Object.entries(raw).map(([key, value]) => ({ key, value }))
  if (raw === undefined || raw === null) return []
  return [{ key: '', value: raw }]
}

/** 汇总迭代结果：`count` 写轮数，其余模式写命中值。 */
function summarizeIteration(collected: unknown[], executed: number, mode: IterationNode['collectMode']): unknown {
  if (mode === 'count') return executed
  if (mode === 'list') return collected
  if (mode === 'last') return collected.length ? collected[collected.length - 1] : []
  return collected.length ? collected[0] : []
}

/**
 * 提示词模板插值：`${path}` 按当前 payload 取值。
 *
 * 与条件节点的字段路径共用同一套解析（含 `a[*].b` 通配投影），
 * 因此「把遍历到的元素拼进提示词」（`${route.iteration.item}`）不需要额外机制。
 * 取值不存在的变量渲染成空串，不会打断整条链路。
 */
function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_matched, rawPath: string) => {
    const path = rawPath.trim()
    if (!path) return ''
    const value = getByPath(payload, path)
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return safeStringify(value) ?? ''
  })
}

/** 能力执行抛出的异常统一转成一句可读的错误文案，进 trace 而不是打断整轮运行。 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 节点输出里展示的取值摘要：短标量原样显示，对象 / 数组序列化后截断。 */
function summarizeValue(value: unknown, maxLength = 200): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const serialized = safeStringify(value) ?? String(value)
  return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized
}

/** 夹住能力调用的超时：节点上配的值可以调，但不允许配出「无上限」。 */
function clampDuration(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return max
  return Math.min(Math.round(value), max)
}

export async function runWorkflow(graph: WorkflowGraph, inputPayload: unknown, options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
  const envelope = normalizeInputPayload(inputPayload)
  const outputPayload = envelope.payload
  const trace: WorkflowTrace[] = []
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const edges = new Map<string, string>()
  for (const edge of graph.edges) edges.set(`${edge.sourceNodeId}:${edge.sourcePort}`, edge.targetNodeId)
  let protocol: WorkflowProtocol = 'unknown'
  const nodeOutputs: NodeOutputMap = {}
  let steps = 0
  let budgetExhausted = false
  let stopReason: WorkflowRunResult['stopReason'] = 'missing-next'

  const execute = async (startId: string | undefined, stopAt?: string): Promise<string | undefined> => {
    let currentId = startId
    while (currentId) {
      if (steps >= MAX_STEPS) {
        budgetExhausted = true
        stopReason = 'max-steps'
        return currentId
      }
      // 回到循环节点本身就代表「本轮结束」，用 stopAt 做边界，不需要隐式子图。
      if (currentId === stopAt) return currentId
      const current = byId.get(currentId)
      if (!current) { stopReason = 'missing-next'; return undefined }
      steps += 1

      if (!current.enabled && current.kind !== 'input' && current.kind !== 'output') {
        // `executed: false`：路径走过了，但这条边上的逻辑一行都没跑（见 `WorkflowTrace.executed`）。
        trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '节点禁用，跳过', executed: false })
        currentId = current.kind === 'protocol-discovery'
          ? resolveProtocolTarget(edges, current.id, 'unknown')
          : edgeTarget(edges, current.id, 'out')
        continue
      }

      if (current.kind === 'input') {
        // 输入节点只报它**保证得了**的东西：本次可见的逻辑模型列表（`logicalModels`）。
        // 请求体里的任何东西都不在它这儿 —— 包括模型名。那是协议层的事实，
        // 路径由协议发现节点按命中的协议声明（§2.3 / §4.1）；在这里读 `request.body.model`
        // 就等于要求输入节点兼容所有协议，而它连「体是什么格式」都不声称。
        addNodeOutput(nodeOutputs, current.id, '逻辑模型', envelope.context.logicalModels.map(model => model.id))
        trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '输入进入路由流程' })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'control-input') {
        applyControlInputs(outputPayload, current)
        const activeControls = current.controls.filter(control => control.enabled)
        // 每个启用的控制项各占一条输出，名称用控制项标签。
        activeControls.forEach(control => addNodeOutput(nodeOutputs, current.id, control.label, control.defaultValue, control.key))
        trace.push({
          nodeId: current.id, nodeName: current.name, kind: current.kind, success: true,
          message: '控制输入已写入 route.controls',
          details: { controls: activeControls.map(control => ({ key: control.key, kind: control.kind, value: control.defaultValue })) },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'protocol-discovery') {
        const discovered = discoverProtocol(current, outputPayload)
        protocol = discovered.protocol
        const normalized = writeRouteProtocol(outputPayload, protocol, discovered.transport)
        addNodeOutput(nodeOutputs, current.id, '协议', protocol)
        addNodeOutput(nodeOutputs, current.id, '传输形态', discovered.transport)
        // 请求模型显示在这道节点上，不在输入节点上：这个节点才知道模型名写在哪。
        // 值就是归一化视图里的那个（两者同源），认不出协议时如实是空串。
        addNodeOutput(nodeOutputs, current.id, '请求模型', normalized.model)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: protocol !== 'unknown',
          message: discovered.reason,
          details: {
            protocol,
            transport: discovered.transport,
            normalized,
          },
        })
        currentId = resolveProtocolTarget(edges, current.id, protocol)
        continue
      }

      if (current.kind === 'condition') {
        const caseResults = current.cases.map(caseNode => ({ caseId: caseNode.id, name: caseNode.name, passed: evaluateCase(caseNode, outputPayload) }))
        const matchedCase = current.cases.find((_case, index) => caseResults[index]?.passed)
        const port = matchedCase?.id ?? 'else'
        // 每个分支各占一条输出：分支名 → 命中 / 未命中。
        caseResults.forEach(item => addNodeOutput(nodeOutputs, current.id, item.name, item.passed ? '命中' : '未命中'))
        currentId = edgeTarget(edges, current.id, port)
        trace.push({
          nodeId: current.id, nodeName: current.name, kind: current.kind, success: Boolean(matchedCase),
          message: matchedCase ? `命中分支 ${matchedCase.name}` : '未命中任何分支，走 ELSE',
          details: { cases: caseResults, matchedCaseId: matchedCase?.id ?? null, sourcePort: port },
        })
        continue
      }

      if (current.kind === 'model-select') {
        const route = routeOf(outputPayload)
        const selection = resolveModelSelection(current, outputPayload)
        route.modelIds = selection.modelIds
        route.fallback = !selection.matched && selection.modelIds.length > 0
        if (current.source === 'variable') {
          addNodeOutput(nodeOutputs, current.id, '取值字段', current.variablePath || '（未配置）')
        }
        addNodeOutput(nodeOutputs, current.id, '落点逻辑模型', selection.modelIds, route.fallback ? '兜底' : undefined)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: selection.modelIds.length > 0,
          message: selection.reason,
          details: {
            modelIds: selection.modelIds,
            matched: selection.matched,
            source: current.source,
            variablePath: current.variablePath,
          },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'iteration') {
        const route = routeOf(outputPayload)
        const items = collectIterationItems(outputPayload, current.sourcePath)
        const bodyEntry = edgeTarget(edges, current.id, 'body')
        const limit = Math.max(1, Math.floor(current.maxIterations))
        const planned = Math.min(items.length, limit)
        const collected: unknown[] = []
        const collectedKeys: string[] = []
        let executed = 0
        let stoppedReason = '全部遍历完成'
        let escapedToOutput = false

        if (!bodyEntry) {
          stoppedReason = '未连接循环体（body 端口），本轮跳过'
          trace.push({
            nodeId: current.id, nodeName: current.name, kind: current.kind, success: false,
            message: '遍历迭代节点没有连接循环体，无法执行',
            details: { sourcePath: current.sourcePath, itemCount: items.length, bodyConnected: false, executed: 0, hitCount: 0 },
          })
        } else {
          for (let index = 0; index < planned; index += 1) {
            const entry = items[index]
            // 每轮把当前作用域投影写进 `route.iteration`，循环体里用 `route.iteration.*` 取值。
            route.iteration = {
              source: current.sourcePath,
              item: entry.value,
              index,
              key: entry.key,
              total: items.length,
            } satisfies RouteIterationScope
            executed += 1

            await execute(bodyEntry, current.id)
            if (budgetExhausted) {
              stoppedReason = '达到步数上限（MAX_STEPS），提前结束'
              break
            }
            if (stopReason === 'output') {
              // 循环体直接连到出口：整轮运行结束，不再继续迭代。
              escapedToOutput = true
              break
            }

            const value = getByPath(outputPayload, current.collectPath)
            const hit = !isEmptyValue(value)
            if (hit) {
              collected.push(value)
              collectedKeys.push(entry.key)
            }
            addNodeOutput(
              nodeOutputs,
              current.id,
              `第 ${index + 1} 轮${entry.key ? `（${entry.key}）` : ''}`,
              hit ? value : '未命中',
              hit ? undefined : current.collectPath,
            )
            if (hit && current.collectMode === 'first') {
              stoppedReason = `第 ${index + 1} 轮首次命中，提前结束`
              break
            }
          }

          if (executed >= limit && limit < items.length) {
            stoppedReason = `达到迭代上限 ${limit} 轮，剩余 ${items.length - limit} 项未遍历`
          }
        }

        const result = summarizeIteration(collected, executed, current.collectMode)
        const resultPath = current.resultPath.trim()
        if (resultPath) setByPath(outputPayload, resultPath, result)

        addNodeOutput(nodeOutputs, current.id, '遍历轮数', executed)
        addNodeOutput(nodeOutputs, current.id, '汇总结果', result)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: Boolean(bodyEntry),
          message: bodyEntry
            ? `迭代完成：来源 ${current.sourcePath || '（未配置）'} 共 ${items.length} 项，执行 ${executed} 轮`
            : '遍历迭代节点没有连接循环体，无法执行',
          details: {
            sourcePath: current.sourcePath,
            collectPath: current.collectPath,
            collectMode: current.collectMode,
            resultPath,
            itemCount: items.length,
            executed,
            hitCount: collected.length,
            hitKeys: collectedKeys,
            stoppedReason,
          },
        })

        if (escapedToOutput) return undefined
        currentId = edgeTarget(edges, current.id, 'out')
        continue
      }

      if (current.kind === 'script') {
        const capability = options.capabilities?.runScript
        if (!capability) {
          trace.push({
            nodeId: current.id, nodeName: current.name, kind: current.kind, success: false,
            message: '脚本节点需要沙箱运行时，当前运行环境没有注入该能力',
            details: { code: current.code, resultPath: current.resultPath },
          })
          currentId = edgeTarget(edges, current.id)
          continue
        }

        const timeout = clampDuration(current.timeoutMilliseconds, SCRIPT_TIMEOUT_LIMIT)
        let outcome: ScriptInvocationResult
        if (!current.code.trim()) {
          outcome = { success: false, logs: [], error: '脚本内容为空', durationMilliseconds: 0 }
        } else {
          const startedAt = Date.now()
          try {
            outcome = await capability({
              nodeId: current.id,
              nodeName: current.name,
              code: current.code,
              timeoutMilliseconds: timeout,
              // 传深拷贝：脚本里的赋值不会污染引擎正在使用的决策数据。
              payload: clonePayload(outputPayload),
            })
          } catch (error) {
            outcome = { success: false, logs: [], error: errorMessage(error), durationMilliseconds: Date.now() - startedAt }
          }
        }

        const resultPath = current.resultPath.trim()
        const written = outcome.success && resultPath ? setByPath(outputPayload, resultPath, outcome.value) : false
        const succeeded = outcome.success && written && Boolean(resultPath)

        addNodeOutput(nodeOutputs, current.id, '脚本结果', succeeded ? outcome.value : (outcome.error ?? '未写入'))
        addNodeOutput(nodeOutputs, current.id, '耗时', `${outcome.durationMilliseconds} ms`)
        if (outcome.logs.length) addNodeOutput(nodeOutputs, current.id, '控制台', outcome.logs)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: succeeded,
          message: !outcome.success
            ? `脚本执行失败：${outcome.error ?? '未知错误'}`
            : succeeded
              ? `脚本执行完成，结果写入 ${resultPath}`
              : `脚本结果无法写入路径 ${resultPath || '（未配置）'}`,
          details: {
            resultPath,
            value: outcome.value,
            summary: summarizeValue(outcome.value),
            logs: outcome.logs,
            error: outcome.error ?? null,
            timeoutMilliseconds: timeout,
            durationMilliseconds: outcome.durationMilliseconds,
          },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'prompt') {
        const capability = options.capabilities?.runPrompt
        const logicalModelId = current.logicalModelId.trim()
        const prompt = renderTemplate(current.promptTemplate, outputPayload)

        if (!capability) {
          trace.push({
            nodeId: current.id, nodeName: current.name, kind: current.kind, success: false,
            message: 'LLM 节点需要服务端执行能力，当前运行环境没有注入该能力',
            details: { logicalModelId, prompt },
          })
          currentId = edgeTarget(edges, current.id)
          continue
        }

        if (!logicalModelId) {
          trace.push({
            nodeId: current.id, nodeName: current.name, kind: current.kind, success: false,
            message: 'LLM 节点尚未选择逻辑模型',
            details: { logicalModelId: '', prompt },
          })
          currentId = edgeTarget(edges, current.id)
          continue
        }

        const timeout = clampDuration(current.timeoutMilliseconds, PROMPT_TIMEOUT_LIMIT)
        let outcome: PromptInvocationResult
        try {
          outcome = await capability({
            nodeId: current.id,
            nodeName: current.name,
            logicalModelId,
            systemPrompt: renderTemplate(current.systemPrompt, outputPayload),
            prompt,
            temperature: current.temperature,
            maxTokens: current.maxTokens,
            timeoutMilliseconds: timeout,
            protocol,
          })
        } catch (error) {
          outcome = { success: false, text: '', error: errorMessage(error), durationMilliseconds: 0 }
        }

        const resultPath = current.resultPath.trim()
        const written = outcome.success && resultPath ? setByPath(outputPayload, resultPath, outcome.text) : false
        const succeeded = outcome.success && written && Boolean(resultPath)

        addNodeOutput(nodeOutputs, current.id, '逻辑模型', logicalModelId)
        addNodeOutput(nodeOutputs, current.id, '提示词', prompt)
        addNodeOutput(nodeOutputs, current.id, '回复', succeeded ? outcome.text : (outcome.error ?? '未写入'))
        addNodeOutput(nodeOutputs, current.id, '耗时', `${outcome.durationMilliseconds} ms`)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: succeeded,
          message: !outcome.success
            ? `LLM 节点执行失败：${outcome.error ?? '未知错误'}`
            : succeeded
              ? `LLM 节点执行完成，回复写入 ${resultPath}`
              : `LLM 回复无法写入路径 ${resultPath || '（未配置）'}`,
          details: {
            logicalModelId,
            target: outcome.target ?? null,
            prompt,
            resultPath,
            reply: summarizeValue(outcome.text),
            raw: outcome.raw ?? null,
            error: outcome.error ?? null,
            timeoutMilliseconds: timeout,
            durationMilliseconds: outcome.durationMilliseconds,
          },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'output') {
        const route = routeOf(outputPayload)
        addNodeOutput(nodeOutputs, current.id, '最终落点', route.modelIds, route.fallback ? '兜底' : undefined)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: route.modelIds.length > 0,
          message: route.modelIds.length > 0
            ? `到达输出节点，落点逻辑模型 ${route.modelIds.join('、')}`
            : '到达输出节点，但没有得到任何可用逻辑模型',
          details: {
            modelIds: route.modelIds,
            fallback: route.fallback,
            includeTrace: current.includeTrace,
            summaryLevel: current.summaryLevel,
          },
        })
        stopReason = 'output'
        return undefined
      }

      // 备注节点不参与执行：它只是画布上的说明。
      // 它没有端口，正常情况下根本不会被接进链路；但只要有人手工把连线改到它身上，
      // 这里也得直接走过去 —— 否则循环里没有分支消耗 `currentId`，整张图会一路空转到步骤预算耗尽。
      if (current.kind === 'note') {
        currentId = edgeTarget(edges, current.id, 'out')
        continue
      }
    }
    return currentId
  }

  const start = graph.nodes.find(node => node.kind === 'input')
  if (!start) return { outputPayload, protocol: 'unknown', nodeOutputs: {}, stopReason: 'error', trace: [buildMissingInputTrace('缺少输入节点')] }
  await execute(start.id)
  return { outputPayload, protocol, nodeOutputs, stopReason, trace }
}

export function createRouteContextInput(payload: RouteContextInput): RouteContextEnvelope {
  return normalizeInputPayload(payload)
}

/**
 * 从一次运行的产出里取路由决策本身（协议 / 传输形态 / 落点）。
 *
 * 调用方（代理入口）读到的应该是**同一份**决策，而不是自己在入口再算一遍协议与传输形态：
 * 图里的协议发现节点可能把协议判成 `unknown`，也可能有节点改写落点，
 * 两套依据各算一遍迟早会分叉。还没走到该写决策的节点时返回 `null`。
 */
export function readRouteDecision(outputPayload: unknown): RouteDecision | null {
  if (!outputPayload || typeof outputPayload !== 'object') return null
  const route = (outputPayload as Record<string, unknown>).route
  if (!route || typeof route !== 'object') return null
  return route as RouteDecision
}

/**
 * 从一次运行的产出里取最终落点逻辑模型 id。
 *
 * 调用方（代理入口）只关心这一件事，不该自己去翻 `route` 命名空间：
 * 那个结构属于引擎，引擎改了字段而调用方不知道就会静默地路由到空列表。
 * 还没走到输出节点时返回空数组。
 */
export function readLandingModelIds(outputPayload: unknown): string[] {
  const route = readRouteDecision(outputPayload)
  if (!route || !Array.isArray(route.modelIds)) return []
  return normalizeModelIds(route.modelIds.map(id => String(id)))
}
