import type { Protocol } from '@common/schemas'
import type { RequestRewriteRule, RequestRewriteRuleAction } from '@common/schemas'

const PROTECTED_HEADERS = new Set(['authorization', 'host', 'content-length', 'connection', 'transfer-encoding'])
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_ACTIONS = 50
const MAX_REPLACEMENTS = 100

export interface RequestRewriteContext {
  stage: 'request' | 'response'
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  streaming?: boolean
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
    if (context.stage === 'response' && context.streaming) { skippedRuleIds.push(rule.id); continue }
    if (actions.length > MAX_ACTIONS) throw new RequestRewriteError('规则动作数量超过限制', rule.id)
    for (const action of actions) {
      if (action.type.startsWith('header-')) applyHeader(currentHeaders, action as Extract<RequestRewriteRuleAction, { type: `header-${string}` }>, rule.id)
      else currentBody = Buffer.from(applyBody(currentBody, action as Extract<RequestRewriteRuleAction, { type: `body-${string}` }>, rule.id))
      if (currentBody.length > MAX_BODY_BYTES) throw new RequestRewriteError('修改后的 Body 超过限制', rule.id)
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
  if (PROTECTED_HEADERS.has(name.toLowerCase())) throw new RequestRewriteError(`禁止修改受保护 Header: ${name}`, ruleId)
  const existingKey = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase()) ?? name
  if (action.type === 'header-remove') { delete headers[existingKey]; return }
  if (typeof action.value !== 'string') throw new RequestRewriteError(`Header 值无效: ${name}`, ruleId)
  if (action.type === 'header-append') {
    const previous = headers[existingKey]
    headers[existingKey] = previous ? `${Array.isArray(previous) ? previous.join(', ') : previous}, ${action.value}` : action.value
  } else headers[existingKey] = action.value
}

function applyBody(body: Buffer, action: BodyAction, ruleId: string): Buffer {
  let value: unknown
  try { value = JSON.parse(body.toString('utf8')) } catch { throw new RequestRewriteError('Body 不是有效 JSON', ruleId) }
  if (action.type === 'body-replace' && action.search.length === 0) throw new RequestRewriteError('Body 替换内容不能为空', ruleId)
  const segments = parsePath(action.path, ruleId)
  if (segments.length > 12) throw new RequestRewriteError('Body 路径深度超过限制', ruleId)
  if (action.type === 'body-set') setPath(value, segments, action.value, ruleId)
  else if (action.type === 'body-delete') deletePath(value, segments, ruleId)
  else replacePath(value, segments, action.search ?? '', action.replacement ?? '', action.regex ?? false, ruleId)
  return Buffer.from(JSON.stringify(value))
}

function parsePath(path: string, ruleId: string): string[] {
  if (!path.startsWith('$.')) throw new RequestRewriteError(`JSON Path 无效: ${path}`, ruleId)
  const segments = path.slice(2).split('.').filter(Boolean)
  if (!segments.length || segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) throw new RequestRewriteError(`JSON Path 无效: ${path}`, ruleId)
  return segments
}
function setPath(root: unknown, segments: string[], value: unknown, ruleId: string): void {
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new RequestRewriteError('JSON 根节点必须是对象', ruleId)
  let current = root as Record<string, unknown>
  for (const segment of segments.slice(0, -1)) {
    if (!(segment in current)) current[segment] = {}
    const child = current[segment]
    if (!child || typeof child !== 'object' || Array.isArray(child)) throw new RequestRewriteError('JSON Path 类型不匹配', ruleId)
    current = child as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}
function deletePath(root: unknown, segments: string[], ruleId: string): void {
  const parent = getParent(root, segments, ruleId); delete parent[segments[segments.length - 1]]
}
function replacePath(root: unknown, segments: string[], search: string, replacement: string, regex: boolean, ruleId: string): void {
  const parent = getParent(root, segments, ruleId); const key = segments[segments.length - 1]; const target = parent[key]
  if (typeof target !== 'string') throw new RequestRewriteError('JSON 替换目标必须是字符串', ruleId)
  try {
    if (regex) {
      const pattern = new RegExp(search, 'g')
      const matches = target.match(pattern)?.length ?? 0
      if (matches > MAX_REPLACEMENTS) throw new RequestRewriteError('替换次数超过限制', ruleId)
      parent[key] = target.replace(pattern, replacement)
    } else {
      const count = target.split(search).length - 1
      if (count > MAX_REPLACEMENTS) throw new RequestRewriteError('替换次数超过限制', ruleId)
      parent[key] = target.split(search).join(replacement)
    }
  } catch (error) {
    if (error instanceof RequestRewriteError) throw error
    throw new RequestRewriteError(`正则表达式无效: ${search}`, ruleId)
  }
}
function getParent(root: unknown, segments: string[], ruleId: string): Record<string, unknown> {
  let current: unknown = root
  for (const segment of segments.slice(0, -1)) { if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) throw new RequestRewriteError('JSON Path 不匹配', ruleId); current = (current as Record<string, unknown>)[segment] }
  if (!current || typeof current !== 'object' || Array.isArray(current)) throw new RequestRewriteError('JSON Path 不匹配', ruleId)
  return current as Record<string, unknown>
}
