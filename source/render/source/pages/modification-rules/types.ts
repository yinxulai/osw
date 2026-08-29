import type { Protocol } from '@common/schemas'

export type RuleStage = 'request' | 'response'
export type RuleStatusFilter = 'all' | 'enabled' | 'disabled'
export type RuleActionTarget = 'header' | 'body'
export type RuleActionOperation = 'set' | 'append' | 'remove' | 'replace'

export interface RuleAction {
  id: string
  stage: RuleStage
  target: RuleActionTarget
  operation: RuleActionOperation
  path: string
  value?: string
  replacement?: string
  regex?: boolean
}

export interface RuleTestCase {
  id: string
  name: string
  stage: RuleStage
  body: string
  headers: string
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  logicalModelId: string
  providerModelId: string
  path: string
  streaming: boolean
}

export interface RequestRewriteRule {
  id: string
  name: string
  description: string
  enabled: boolean
  global: boolean
  protocols: string[]
  match: { clientProtocols: string[]; upstreamProtocols: string[]; path?: string; logicalModelId?: string; providerModelId?: string }
  actions: RuleAction[]
  testCases: RuleTestCase[]
  boundProviders: number
  updatedAt: string
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

export const protocolOptions = [
  'OpenAI Completions',
  'OpenAI Responses',
  'Anthropic Messages',
] as const

export const initialRules: RequestRewriteRule[] = [
  {
    id: 'rule-user-agent',
    name: '统一客户端标识',
    description: '为发往上游的请求设置统一 User-Agent，便于供应商侧识别。',
    enabled: true,
    global: true,
    protocols: ['OpenAI Completions', 'OpenAI Responses', 'Anthropic Messages'],
    match: { clientProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'], upstreamProtocols: [] },
    actions: [
      { id: 'action-ua', stage: 'request', target: 'header', operation: 'set', path: 'User-Agent', value: 'One-Switch/0.3' },
    ],
    testCases: [],
    boundProviders: 0,
    updatedAt: '刚刚',
  },
  {
    id: 'rule-reasoning',
    name: '兼容 reasoning 参数',
    description: '为不接受 reasoning_effort 的上游删除对应请求字段。',
    enabled: true,
    global: false,
    protocols: ['OpenAI Completions'],
    match: { clientProtocols: ['openai-completions'], upstreamProtocols: [] },
    actions: [
      { id: 'action-reasoning', stage: 'request', target: 'body', operation: 'remove', path: '$.reasoning_effort' },
      { id: 'action-thinking', stage: 'request', target: 'body', operation: 'remove', path: '$.thinking' },
    ],
    testCases: [],
    boundProviders: 3,
    updatedAt: '昨天',
  },
  {
    id: 'rule-metadata',
    name: '补充请求元数据',
    description: '向 Responses 请求中补充应用来源元数据。',
    enabled: false,
    global: false,
    protocols: ['OpenAI Responses'],
    match: { clientProtocols: ['openai-responses'], upstreamProtocols: [] },
    actions: [
      { id: 'action-source', stage: 'request', target: 'body', operation: 'set', path: '$.metadata.source', value: 'one-switch' },
      { id: 'action-cache', stage: 'request', target: 'header', operation: 'set', path: 'X-Client-Cache', value: 'enabled' },
    ],
    testCases: [],
    boundProviders: 1,
    updatedAt: '3 天前',
  },
  {
    id: 'rule-response',
    name: '清理响应扩展字段',
    description: '在非流式响应返回客户端前移除供应商私有字段。',
    enabled: true,
    global: false,
    protocols: ['Anthropic Messages'],
    match: { clientProtocols: ['anthropic-messages'], upstreamProtocols: [] },
    actions: [
      { id: 'action-provider-meta', stage: 'response', target: 'body', operation: 'remove', path: '$.provider_metadata' },
    ],
    testCases: [],
    boundProviders: 2,
    updatedAt: '1 周前',
  },
]
