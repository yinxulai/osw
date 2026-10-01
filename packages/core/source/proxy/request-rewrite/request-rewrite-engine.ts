import type { Protocol, RequestRewriteRule, RequestRewriteRuleAction } from '@common/schemas'
import type { BodyDeliveryShape } from '@server/proxy/contracts'
import { executeRewriteScript } from './rewrite-script-sandbox'

const PROTECTED_HEADERS = new Set(['authorization', 'host', 'content-length', 'connection', 'transfer-encoding'])
/**
 * 传输形态在正文里的落点。现行三个协议（openai-completions / anthropic-messages / openai-responses）
 * 都用根级 `stream` 表达「这一跳要增量还是整包」，因此它不是一个普通的业务字段。
 *
 * 改写规则**不许碰它**。形态在规划期就由客户端自己的声明定下来（§1.1），规则把它改掉
 * 等于替客户端改主意：代理会按「非流式」转发上游，却仍然按「流式」交付客户端——
 * 两边对「这一跳是什么形态」的认知当场分叉，而这正是代理最不该制造的状态。
 */
const PROTECTED_BODY_FIELDS = new Set(['stream'])
const MAX_ACTIONS = 50

export interface RequestRewriteContext {
  stage: 'request' | 'response'
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  /**
   * 响应阶段这一次交付的正文形态（{@link BodyDeliveryShape}）。只有响应阶段会用到。
   *
   * 取的是**交付形态**而不是「客户端跳的 transport」：规则能不能动手，取决于手里这堆字节
   * 是不是一整份（见 `bodyDeliveryShape`）。两者今天恰好同义，但这里问的是前者，
   * 因此不能写成一个只在这套取值域下成立的等价式。
   */
  shape?: BodyDeliveryShape
}

export interface RequestRewriteResult {
  body: Buffer
  headers: Record<string, string | string[] | undefined>
  appliedRuleIds: string[]
  skippedRuleIds: string[]
  /** 本次执行里所有脚本动作回传的日志（`console.log / warn / error`），供规则试跑展示。 */
  scriptLogs: string[]
}

type HeaderAction = Extract<RequestRewriteRuleAction, { type: `header-${string}` }>
type BodyAction = Extract<RequestRewriteRuleAction, { type: `body-${string}` }>
type ScriptAction = Extract<RequestRewriteRuleAction, { type: 'script' }>

export class RequestRewriteError extends Error {
  readonly code = 'REQUEST_REWRITE_RULE_FAILED'
  constructor(message: string, readonly ruleId?: string) { super(message) }
}

export function applyRequestRewriteRules(body: Buffer, headers: Record<string, string | string[] | undefined>, rules: readonly RequestRewriteRule[], context: RequestRewriteContext): RequestRewriteResult {
  let currentBody = Buffer.from(body)
  const currentHeaders = { ...headers }
  const appliedRuleIds: string[] = []
  const skippedRuleIds: string[] = []
  const scriptLogs: string[] = []
  for (const rule of rules) {
    if (!rule.enabled || rule.deletedTime !== null) { skippedRuleIds.push(rule.id); continue }
    const actions = rule.actions.filter(action => action.stage === context.stage)
    if (actions.length === 0 || !matches(rule, context)) { skippedRuleIds.push(rule.id); continue }
    if (context.stage === 'response' && context.shape === 'incremental') { skippedRuleIds.push(rule.id); continue }
    if (actions.length > MAX_ACTIONS) throw new RequestRewriteError('Too many rule actions', rule.id)
    for (const action of actions) {
      if (action.type.startsWith('header-')) applyHeader(currentHeaders, action as HeaderAction, rule.id)
      else if (action.type === 'script') currentBody = Buffer.from(applyScript(currentBody, currentHeaders, action as ScriptAction, rule, context, scriptLogs))
      else currentBody = Buffer.from(applyBody(currentBody, action as BodyAction, rule.id))
    }
    appliedRuleIds.push(rule.id)
  }
  if (currentBody.length > 0) currentHeaders['content-length'] = String(currentBody.length)
  return { body: currentBody, headers: currentHeaders, appliedRuleIds, skippedRuleIds, scriptLogs }
}

function matches(rule: RequestRewriteRule, context: RequestRewriteContext): boolean {
  const match = rule.match
  if (match.clientProtocols.length && !match.clientProtocols.includes(context.clientProtocol)) return false
  if (match.upstreamProtocols.length && !match.upstreamProtocols.includes(context.upstreamProtocol)) return false
  return true
}

function applyHeader(headers: Record<string, string | string[] | undefined>, action: HeaderAction, ruleId: string): void {
  const name = action.name
  if (PROTECTED_HEADERS.has(name.toLowerCase())) throw new RequestRewriteError(`Modifying a protected header is not allowed: ${name}`, ruleId)
  const existingKey = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase()) ?? name
  if (action.type === 'header-remove') { delete headers[existingKey]; return }
  if (typeof action.value !== 'string') throw new RequestRewriteError(`Invalid header value: ${name}`, ruleId)
  if (action.type === 'header-append') {
    const previous = headers[existingKey]
    headers[existingKey] = previous ? `${Array.isArray(previous) ? previous.join(', ') : previous}, ${action.value}` : action.value
  } else headers[existingKey] = action.value
}

/**
 * 脚本动作：在沙箱里跑用户代码，把交回的 `{ body, headers }` **整体替换**回报文。
 *
 * 与结构化 body 动作有一处刻意的差异：body 解析失败时**不报错**，而是把 `null` 交给脚本
 * （`ctx.body === null` 由脚本自行决定是否 `throw`）。因为脚本要表达的正是「先看内容再决定
 * 怎么改」，把「是不是 JSON」这个判断也交给它，比引擎替它先拒绝更贴合它的用途。
 *
 * 交回对象的替换语义见 {@link replaceScriptHeaders} 与 `rewrite-script-sandbox.ts` 的
 * `normalizeOutcome`：**交回谁就整体替换谁**（省略的字段 / 键即删除），两个键都没交回才表示
 * 整条不改动；脚本整体失败则阻断当前 attempt。
 */
function applyScript(body: Buffer, headers: Record<string, string | string[] | undefined>, action: ScriptAction, rule: RequestRewriteRule, context: RequestRewriteContext, scriptLogs: string[]): Buffer {
  const parsedBody = parseBodyLenient(body)
  const result = executeRewriteScript({
    ruleId: rule.id,
    code: action.code,
    timeoutMilliseconds: action.timeoutMilliseconds,
    body: parsedBody,
    headers: { ...headers },
    context: { stage: context.stage, clientProtocol: context.clientProtocol, upstreamProtocol: context.upstreamProtocol },
  })
  scriptLogs.push(...result.logs)
  if (!result.success) throw new RequestRewriteError(result.error ?? 'Script execution failed', rule.id)
  // 只有「两个键都没返回」才是「整条不动」。返回了任意一个，就按**完整替换**处理：
  // 省略的字段即删除。以前的逐键合并做不到删除（见 replaceScriptHeaders）。
  if (result.body === undefined && result.headers === undefined) return body
  if (result.headers !== undefined) replaceScriptHeaders(headers, result.headers, rule.id)
  if (result.body === undefined) return body
  assertDeliveryModeUnchanged(parsedBody, result.body, rule.id)
  return Buffer.from(JSON.stringify(result.body))
}

function parseBodyLenient(body: Buffer): unknown {
  if (body.length === 0) return null
  try { return JSON.parse(body.toString('utf8')) } catch { return null }
}

/**
 * 脚本同样不许改动投递形态字段（`stream`）。
 *
 * 结构化 body 动作靠 `parsePath` 拒绝对根级 `stream` 取值来做这件事；脚本改的是整份 body，
 * 没有「路径」可拦，因此改为**按改动结果判**：新旧 body 的 `stream` 取值不同即视为违规。
 * 逐字比对而不是「禁止出现 `stream` 键」——脚本原样带上一个 `stream` 不算「改主意」。
 */
function assertDeliveryModeUnchanged(before: unknown, after: unknown, ruleId: string): void {
  for (const field of PROTECTED_BODY_FIELDS) {
    if (readOwnField(before, field) !== readOwnField(after, field)) {
      throw new RequestRewriteError(`Modifying a delivery-mode field is not allowed: ${field}`, ruleId)
    }
  }
}

function readOwnField(value: unknown, field: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined
}

/**
 * 把脚本交回的 Header 整体替换掉当前头。
 *
 * 用的是**完整替换**而不是逐键合并：交回的这份就是脚本眼前的全部 Header，脚本没写的
 * 键即视为删除。逐键合并做不到删除（写 `undefined` 只是把值置空、`null` 归一成空串），
 * 这正是「省略字段删不掉」的根因。
 *
 * 校验分两步：
 * - 先比对**改动前后取值**，受保护 Header 只要真的变了就失败；原样带回去（值相同）
 *   不算违规 —— 否则任何 `{ ...headers }` 的写法都会因为夹带了 `content-length` / `host`
 *   而误伤；
 * - 再按大小写不敏感对齐大小写，避免同一头出现 `X-Test` 与 `x-test` 两个键。
 */
function replaceScriptHeaders(headers: Record<string, string | string[] | undefined>, next: Record<string, string | string[] | undefined>, ruleId: string): void {
  for (const name of PROTECTED_HEADERS) {
    if (readHeader(headers, name) !== readHeader(next, name)) throw new RequestRewriteError(`Modifying a protected header is not allowed: ${name}`, ruleId)
  }
  const replaced: Record<string, string | string[] | undefined> = {}
  for (const [name, value] of Object.entries(next)) {
    const existingKey = Object.keys(replaced).find(key => key.toLowerCase() === name.toLowerCase())
    replaced[existingKey ?? name] = value
  }
  for (const key of Object.keys(headers)) delete headers[key]
  Object.assign(headers, replaced)
}

/** 大小写不敏感地读一个头，用于「取值是否变过」的比对。 */
function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | string[] | undefined {
  const key = Object.keys(headers).find(item => item.toLowerCase() === name)
  return key === undefined ? undefined : headers[key]
}

function applyBody(body: Buffer, action: BodyAction, ruleId: string): Buffer {
  let value: unknown
  try { value = JSON.parse(body.toString('utf8')) } catch { throw new RequestRewriteError('The body is not valid JSON', ruleId) }
  if (action.type === 'body-replace' && action.search.length === 0) throw new RequestRewriteError('The body replacement search string must not be empty', ruleId)
  const segments = parsePath(action.path, ruleId)
  if (action.type === 'body-set') setPath(value, segments, action.value, ruleId)
  else if (action.type === 'body-delete') deletePath(value, segments, ruleId)
  else replacePath(value, segments, action.search ?? '', action.replacement ?? '', action.regex ?? false, ruleId)
  return Buffer.from(JSON.stringify(value))
}

function parsePath(path: string, ruleId: string): string[] {
  if (!path.startsWith('$.')) throw new RequestRewriteError(`Invalid JSON path: ${path}`, ruleId)
  const segments = path.slice(2).split('.').filter(Boolean)
  if (!segments.length || segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) throw new RequestRewriteError(`Invalid JSON path: ${path}`, ruleId)
  if (segments.length === 1 && PROTECTED_BODY_FIELDS.has(segments[0])) throw new RequestRewriteError(`Modifying a delivery-mode field is not allowed: ${path}`, ruleId)
  return segments
}
function setPath(root: unknown, segments: string[], value: unknown, ruleId: string): void {
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new RequestRewriteError('The JSON root must be an object', ruleId)
  let current = root as Record<string, unknown>
  for (const segment of segments.slice(0, -1)) {
    if (!(segment in current)) current[segment] = {}
    const child = current[segment]
    if (!child || typeof child !== 'object' || Array.isArray(child)) throw new RequestRewriteError('JSON path type mismatch', ruleId)
    current = child as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}
function deletePath(root: unknown, segments: string[], ruleId: string): void {
  const parent = getParent(root, segments, ruleId); delete parent[segments[segments.length - 1]]
}
function replacePath(root: unknown, segments: string[], search: string, replacement: string, regex: boolean, ruleId: string): void {
  const parent = getParent(root, segments, ruleId); const key = segments[segments.length - 1]; const target = parent[key]
  if (typeof target !== 'string') throw new RequestRewriteError('The JSON replacement target must be a string', ruleId)
  try {
    if (regex) parent[key] = target.replace(new RegExp(search, 'g'), replacement)
    else parent[key] = target.split(search).join(replacement)
  } catch (error) {
    if (error instanceof RequestRewriteError) throw error
    throw new RequestRewriteError(`Invalid regular expression: ${search}`, ruleId)
  }
}
function getParent(root: unknown, segments: string[], ruleId: string): Record<string, unknown> {
  let current: unknown = root
  for (const segment of segments.slice(0, -1)) { if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) throw new RequestRewriteError('JSON path did not match', ruleId); current = (current as Record<string, unknown>)[segment] }
  if (!current || typeof current !== 'object' || Array.isArray(current)) throw new RequestRewriteError('JSON path did not match', ruleId)
  return current as Record<string, unknown>
}
