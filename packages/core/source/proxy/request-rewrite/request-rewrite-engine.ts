import type { Protocol, RequestRewriteRule, RequestRewriteRuleAction } from '@common/schemas'
import type { BodyDeliveryShape } from '@server/proxy/contracts'

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
}

type HeaderAction = Extract<RequestRewriteRuleAction, { type: `header-${string}` }>
type BodyAction = Extract<RequestRewriteRuleAction, { type: `body-${string}` }>

export class RequestRewriteError extends Error {
  readonly code = 'REQUEST_REWRITE_RULE_FAILED'
  constructor(message: string, readonly ruleId?: string) { super(message) }
}

export function applyRequestRewriteRules(body: Buffer, headers: Record<string, string | string[] | undefined>, rules: readonly RequestRewriteRule[], context: RequestRewriteContext): RequestRewriteResult {
  let currentBody = Buffer.from(body)
  const currentHeaders = { ...headers }
  const appliedRuleIds: string[] = []
  const skippedRuleIds: string[] = []
  for (const rule of rules) {
    if (!rule.enabled || rule.deletedTime !== null) { skippedRuleIds.push(rule.id); continue }
    const actions = rule.actions.filter(action => action.stage === context.stage)
    if (actions.length === 0 || !matches(rule, context)) { skippedRuleIds.push(rule.id); continue }
    if (context.stage === 'response' && context.shape === 'incremental') { skippedRuleIds.push(rule.id); continue }
    if (actions.length > MAX_ACTIONS) throw new RequestRewriteError('Too many rule actions', rule.id)
    for (const action of actions) {
      if (action.type.startsWith('header-')) applyHeader(currentHeaders, action as Extract<RequestRewriteRuleAction, { type: `header-${string}` }>, rule.id)
      else currentBody = Buffer.from(applyBody(currentBody, action as Extract<RequestRewriteRuleAction, { type: `body-${string}` }>, rule.id))
    }
    appliedRuleIds.push(rule.id)
  }
  if (currentBody.length > 0) currentHeaders['content-length'] = String(currentBody.length)
  return { body: currentBody, headers: currentHeaders, appliedRuleIds, skippedRuleIds }
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
