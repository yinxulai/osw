import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { ProtocolSchema, REWRITE_SCRIPT_TIMEOUT_DEFAULT } from '@common/schemas'
import type { Protocol, RequestRewriteRuleAction, TransportKind } from '@common/schemas'

export type RuleStage = 'request' | 'response'
export type RuleStatusFilter = 'all' | 'enabled' | 'disabled'
export type RuleActionTarget = 'header' | 'body' | 'script'
export type RuleActionOperation = 'set' | 'append' | 'remove' | 'replace'

/**
 * 规则的来源。库里的三档，与 `@common/schemas` 的 `source` 一一对应。
 *
 * 它是**用户数据**的一部分，不是显示用的派生值：界面必须原样读进来、原样写回去。之前两处
 * 硬编码 `user`，结果是编辑一条从模板建的规则会把它默默改成「自己写的」，而遥测要回答的
 * 「内建模板有人用吗」在界面里永远接不通（见 `@common/telemetry` 的 `rewrite_rule_created`）。
 */
export type RuleSource = 'user' | 'builtin' | 'imported'

export interface RuleAction {
  id: string
  stage: RuleStage
  target: RuleActionTarget
  operation: RuleActionOperation
  path: string
  value?: string
  replacement?: string
  regex?: boolean
  /** 脚本动作的源码（函数体形式）。仅当 `target === 'script'` 时有意义。 */
  code?: string
  /** 脚本动作的超时上限（毫秒）。仅当 `target === 'script'` 时有意义。 */
  timeoutMilliseconds?: number
}

export interface RuleTestCase {
  id: string
  name: string
  stage: RuleStage
  body: string
  headers: string
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  /** 试跑时假设的传输形态；响应阶段的动作在 `http-stream` 下不适用。 */
  transport: TransportKind
}

export interface RequestRewriteRule {
  id: string
  name: string
  description: string
  enabled: boolean
  global: boolean
  /** 这条规则是怎么来的（模板 / 自己写的 / 导入的）。 */
  source: RuleSource
  /** 匹配的客户端协议；留空表示不限制。 */
  protocols: Protocol[]
  match: { clientProtocols: Protocol[]; upstreamProtocols: Protocol[] }
  actions: RuleAction[]
  testCases: RuleTestCase[]
  boundProviders: number
  /** 服务端记录的更新时间；`null` 表示这条规则还没保存过。 */
  updatedTime: number | null
}

export function formatJsonActionValue(value: unknown) {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, 2)
}

export function parseJsonActionValue(value: string | undefined): unknown {
  if (value === undefined || value.trim() === '') return ''
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/**
 * 契约动作 → 界面动作。
 *
 * 界面把「Header / Body / 脚本」压平成三个字段（`target` / `operation` / `path`），
 * 契约里则是一个按 `type` 判别的联合。这里就是那次映射的唯一落点：之前它散在页面与
 * 试跑对话框两处，加一种动作类型要改两遍，漏掉一处就是「保存对了、试跑却错了」。
 */
export function toUiRuleAction(action: RequestRewriteRuleAction, id: string): RuleAction {
  switch (action.type) {
    case 'script':
      return { id, stage: action.stage, target: 'script', operation: 'set', path: '', code: action.code, timeoutMilliseconds: action.timeoutMilliseconds }
    case 'header-set':
      return { id, stage: action.stage, target: 'header', operation: 'set', path: action.name, value: action.value }
    case 'header-append':
      return { id, stage: action.stage, target: 'header', operation: 'append', path: action.name, value: action.value }
    case 'header-remove':
      return { id, stage: action.stage, target: 'header', operation: 'remove', path: action.name, value: '' }
    case 'body-set':
      return { id, stage: action.stage, target: 'body', operation: 'set', path: action.path, value: formatJsonActionValue(action.value) }
    case 'body-delete':
      return { id, stage: action.stage, target: 'body', operation: 'remove', path: action.path }
    case 'body-replace':
      return { id, stage: action.stage, target: 'body', operation: 'replace', path: action.path, value: action.search, replacement: action.replacement, regex: action.regex }
  }
}

/** 界面动作 → 契约动作。`toUiRuleAction` 的逆映射，保存与试跑共用同一份。 */
export function toApiRuleAction(action: RuleAction): RequestRewriteRuleAction {
  if (action.target === 'script') {
    return { type: 'script', stage: action.stage, code: action.code ?? '', timeoutMilliseconds: action.timeoutMilliseconds ?? REWRITE_SCRIPT_TIMEOUT_DEFAULT }
  }
  if (action.target === 'header') {
    if (action.operation === 'remove') return { type: 'header-remove', stage: action.stage, name: action.path }
    return { type: action.operation === 'append' ? 'header-append' : 'header-set', stage: action.stage, name: action.path, value: action.value ?? '' }
  }
  if (action.operation === 'remove') return { type: 'body-delete', stage: action.stage, path: action.path }
  if (action.operation === 'replace') return { type: 'body-replace', stage: action.stage, path: action.path, search: action.value ?? '', replacement: action.replacement ?? '', regex: action.regex ?? false }
  return { type: 'body-set', stage: action.stage, path: action.path, value: parseJsonActionValue(action.value) }
}

/** 匹配协议与协议选择器都按枚举取值流转，展示时才经 `PROTOCOL_LABELS` 变成名字。 */
export const PROTOCOL_OPTIONS: Protocol[] = [...ProtocolSchema.options]

/** 协议标识是供应商的产品名，两种界面语言下写法相同，因此不进翻译目录。 */
export const PROTOCOL_LABELS: Record<Protocol, string> = { ...PROTOCOL_DISPLAY_NAMES }
