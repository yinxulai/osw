import type { V2NodeKind, WorkflowV2Node } from './types'

export const queueOptions = [
  'queue-vip-cn',
  'queue-default',
  'queue-low-priority',
  'queue-anthropic-fallback',
]

export const samplePayload = {
  request: {
    path: '/v1/messages',
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
    tenant: 'vip-cn',
    priority: 9,
    prompt: '  Please summarize this article.  ',
  },
  response: {
    status: 200,
    body: {
      content: 'origin response',
    },
  },
  vars: {},
  route: {},
  metadata: {
    source: 'desktop-client',
  },
}

export const nodeTemplates: Array<{ kind: V2NodeKind; label: string; hint: string }> = [
  { kind: 'context-extract', label: '上下文提取', hint: '提取请求字段到 vars，供后续条件判断' },
  { kind: 'condition', label: '条件判断', hint: '按字段和值分流到 true / false' },
  { kind: 'modifier', label: '修改器', hint: '写入或覆盖 payload 字段' },
  { kind: 'transformer', label: '转换器', hint: 'trim / 大小写 / stringify' },
  { kind: 'route-queue', label: '队列转发', hint: '设置目标队列 ID' },
  { kind: 'dispatch', label: '请求分发', hint: '模拟把请求发送到目标队列' },
  { kind: 'response-mutate', label: '响应修改', hint: '在返回前改写响应字段' },
]

export const initialNodes: WorkflowV2Node[] = [
  {
    id: 'start',
    kind: 'start',
    name: '开始',
    enabled: true,
    x: 60,
    y: 120,
    next: 'extract-ua',
  },
  {
    id: 'extract-ua',
    kind: 'context-extract',
    name: '提取 UA',
    enabled: true,
    x: 320,
    y: 120,
    sourcePath: 'request.headers.user-agent',
    targetPath: 'vars.ua',
    next: 'check-mobile',
  },
  {
    id: 'check-mobile',
    kind: 'condition',
    name: '判断移动端 UA',
    enabled: true,
    x: 600,
    y: 90,
    path: 'vars.ua',
    operator: 'contains',
    value: 'iPhone',
    nextTrue: 'route-mobile',
    nextFalse: 'route-default',
  },
  {
    id: 'route-mobile',
    kind: 'route-queue',
    name: '转发移动端队列',
    enabled: true,
    x: 860,
    y: 40,
    queueId: 'queue-vip-cn',
    next: 'mutate-request',
  },
  {
    id: 'route-default',
    kind: 'route-queue',
    name: '转发默认队列',
    enabled: true,
    x: 860,
    y: 220,
    queueId: 'queue-default',
    next: 'mutate-request',
  },
  {
    id: 'mutate-request',
    kind: 'modifier',
    name: '请求写入标签',
    enabled: true,
    x: 1140,
    y: 120,
    path: 'request.headers.x-flow-tag',
    value: 'orchestrator-v3',
    next: 'dispatch',
  },
  {
    id: 'dispatch',
    kind: 'dispatch',
    name: '分发请求',
    enabled: true,
    x: 1400,
    y: 120,
    mockStatus: 200,
    next: 'mutate-response',
  },
  {
    id: 'mutate-response',
    kind: 'response-mutate',
    name: '响应写入路由信息',
    enabled: true,
    x: 1650,
    y: 120,
    path: 'response.body.routedQueue',
    value: '{{route.targetQueue}}',
    next: 'end',
  },
  {
    id: 'end',
    kind: 'end',
    name: '输出',
    enabled: true,
    x: 1910,
    y: 120,
  },
]
