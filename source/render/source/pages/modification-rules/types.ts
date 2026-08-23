export type RuleStage = 'request' | 'response'
export type RuleStatusFilter = 'all' | 'enabled' | 'disabled'
export type RuleActionType = 'header-set' | 'header-remove' | 'json-set' | 'json-delete' | 'json-replace'

export interface RuleAction {
  id: string
  type: RuleActionType
  target: string
  value?: string
  replacement?: string
}

export interface ModificationRule {
  id: string
  name: string
  description: string
  enabled: boolean
  global: boolean
  stage: RuleStage
  protocols: string[]
  actions: RuleAction[]
  boundProviders: number
  updatedAt: string
}

export const protocolOptions = [
  'OpenAI Completions',
  'OpenAI Responses',
  'Anthropic Messages',
] as const

export const initialRules: ModificationRule[] = [
  {
    id: 'rule-user-agent',
    name: '统一客户端标识',
    description: '为发往上游的请求设置统一 User-Agent，便于供应商侧识别。',
    enabled: true,
    global: true,
    stage: 'request',
    protocols: ['OpenAI Completions', 'OpenAI Responses', 'Anthropic Messages'],
    actions: [
      { id: 'action-ua', type: 'header-set', target: 'User-Agent', value: 'One-Switch/0.3' },
    ],
    boundProviders: 0,
    updatedAt: '刚刚',
  },
  {
    id: 'rule-reasoning',
    name: '兼容 reasoning 参数',
    description: '为不接受 reasoning_effort 的上游删除对应请求字段。',
    enabled: true,
    global: false,
    stage: 'request',
    protocols: ['OpenAI Completions'],
    actions: [
      { id: 'action-reasoning', type: 'json-delete', target: '$.reasoning_effort' },
      { id: 'action-thinking', type: 'json-delete', target: '$.thinking' },
    ],
    boundProviders: 3,
    updatedAt: '昨天',
  },
  {
    id: 'rule-metadata',
    name: '补充请求元数据',
    description: '向 Responses 请求中补充应用来源元数据。',
    enabled: false,
    global: false,
    stage: 'request',
    protocols: ['OpenAI Responses'],
    actions: [
      { id: 'action-source', type: 'json-set', target: '$.metadata.source', value: 'one-switch' },
      { id: 'action-cache', type: 'header-set', target: 'X-Client-Cache', value: 'enabled' },
    ],
    boundProviders: 1,
    updatedAt: '3 天前',
  },
  {
    id: 'rule-response',
    name: '清理响应扩展字段',
    description: '在非流式响应返回客户端前移除供应商私有字段。',
    enabled: true,
    global: false,
    stage: 'response',
    protocols: ['Anthropic Messages'],
    actions: [
      { id: 'action-provider-meta', type: 'json-delete', target: '$.provider_metadata' },
    ],
    boundProviders: 2,
    updatedAt: '1 周前',
  },
]
