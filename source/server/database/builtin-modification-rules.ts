import { ModificationRuleSchema, type ModificationRule } from '@common/schemas'

/**
 * 系统内置请求修改不属于用户数据，直接由当前版本代码定义。
 * 这样新版本可以随代码发布规则变更，而不依赖数据库迁移或 seed 状态。
 */
const builtinRules: ModificationRule[] = [
  {
    id: 'rule_builtin_user_agent',
    name: '统一客户端标识',
    description: '为上游请求设置稳定的客户端标识。',
    enabled: true,
    scope: 'global',
    schemaVersion: 1,
    source: 'builtin',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ stage: 'request', type: 'header-set', name: 'User-Agent', value: 'One-Switch/0.3' }],
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  },
  {
    id: 'rule_builtin_reasoning_cleanup',
    name: '兼容 reasoning 参数',
    description: '删除不兼容供应商的 reasoning/thinking 请求字段。',
    enabled: true,
    scope: 'global',
    schemaVersion: 1,
    source: 'builtin',
    match: { clientProtocols: ['openai-completions'], upstreamProtocols: [] },
    actions: [
      { stage: 'request', type: 'body-delete', path: '$.reasoning_effort' },
      { stage: 'request', type: 'body-delete', path: '$.thinking' },
    ],
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  },
  {
    id: 'rule_builtin_responses_metadata',
    name: '补充请求元数据',
    description: '为 Responses 请求补充来源元数据。',
    enabled: true,
    scope: 'global',
    schemaVersion: 1,
    source: 'builtin',
    match: { clientProtocols: ['openai-responses'], upstreamProtocols: [] },
    actions: [{ stage: 'request', type: 'body-set', path: '$.metadata.source', value: 'one-switch' }],
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  },
  {
    id: 'rule_builtin_response_metadata_cleanup',
    name: '清理响应扩展字段',
    description: '移除响应中的供应商私有元数据。',
    enabled: true,
    scope: 'global',
    schemaVersion: 1,
    source: 'builtin',
    match: { clientProtocols: ['anthropic-messages'], upstreamProtocols: [] },
    actions: [{ stage: 'response', type: 'body-delete', path: '$.provider_metadata' }],
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  },
]

export const BUILTIN_MODIFICATION_RULES: readonly ModificationRule[] = builtinRules.map(rule => ModificationRuleSchema.parse(rule))
export function getBuiltinModificationRule(id: string): ModificationRule | undefined {
  return BUILTIN_MODIFICATION_RULES.find(rule => rule.id === id)
}
