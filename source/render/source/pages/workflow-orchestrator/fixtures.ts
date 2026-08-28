import type { OrchestratorNode } from './types'

export const samplePayload = {
  request: {
    path: '/v1/messages',
    model: 'claude-4-sonnet',
    tenant: 'vip-cn',
    priority: 8,
    prompt: '  Please summarize this article.  ',
  },
  metadata: {
    region: 'cn-hz',
    source: 'desktop-client',
  },
}

export const queueOptions = [
  'queue-vip-cn',
  'queue-default',
  'queue-low-priority',
  'queue-anthropic-fallback',
]

export const nodeTemplates: Array<{ kind: OrchestratorNode['kind']; label: string; description: string }> = [
  {
    kind: 'condition',
    label: '条件判断',
    description: '按路径和值判断命中，失败可中断流程或继续。',
  },
  {
    kind: 'modifier',
    label: '修改器',
    description: '写入任意字段，可输入数字/布尔/JSON 字面量。',
  },
  {
    kind: 'transformer',
    label: '转换器',
    description: '对字段做 trim / 大小写 / JSON stringify。',
  },
  {
    kind: 'route-queue',
    label: '队列转发',
    description: '设置目标队列，作为调度输出。',
  },
]

export const initialNodes: OrchestratorNode[] = [
  {
    id: 'node-1',
    kind: 'condition',
    name: 'VIP 客户识别',
    enabled: true,
    config: {
      path: 'request.tenant',
      operator: 'contains',
      value: 'vip',
      onFalse: 'continue',
    },
  },
  {
    id: 'node-2',
    kind: 'modifier',
    name: '打上请求标签',
    enabled: true,
    config: {
      path: 'metadata.flowTag',
      value: 'workflow-prototype',
    },
  },
  {
    id: 'node-3',
    kind: 'transformer',
    name: '标准化 prompt',
    enabled: true,
    config: {
      fromPath: 'request.prompt',
      toPath: 'request.promptNormalized',
      mode: 'trim',
    },
  },
  {
    id: 'node-4',
    kind: 'condition',
    name: '高优先级分流',
    enabled: true,
    config: {
      path: 'request.priority',
      operator: 'gt',
      value: '5',
      onFalse: 'continue',
    },
  },
  {
    id: 'node-5',
    kind: 'route-queue',
    name: '路由到 VIP 队列',
    enabled: true,
    config: {
      queueId: 'queue-vip-cn',
    },
  },
]
