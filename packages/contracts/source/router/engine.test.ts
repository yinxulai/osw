import { describe, expect, it } from 'vitest'
import { runWorkflow as runWorkflowEngine, type WorkflowRunOptions } from './engine'
import { createDefaultPolicyGraph, createLlmComplexityGraph, createScriptRoutingGraph, createUserAgentGraph, ROUTER_POLICY_PRESETS } from './presets'
import { WorkflowGraphSchema } from './schemas'
import { PROMPT_TIMEOUT_DEFAULT, SCRIPT_TIMEOUT_DEFAULT } from './types'
import type { ConditionCase, ConditionRule, PromptInvocation, ScriptInvocation, WorkflowGraph, WorkflowNodeModel } from './types'

const edge = (sourceNodeId: string, sourcePort: string, targetNodeId: string) => ({ id: `${sourceNodeId}:${sourcePort}->${targetNodeId}`, sourceNodeId, sourcePort, targetNodeId })

function runWorkflow(graph: WorkflowGraph, inputPayload: unknown, options?: WorkflowRunOptions) {
  return runWorkflowEngine(graph, inputPayload, options)
}

/**
 * 策略预设测试用的逻辑模型列表。
 *
 * `default` 是内置默认落点；另外两个是分流落点的候选——预设生成时会按顺序取它们，
 * 所以这里至少给两个，才能验出「两个分支落点不同」。
 */
const presetLogicalModels = [
  { id: 'default', name: 'Default', enabled: true },
  { id: 'model-fast', name: 'Model Fast', enabled: true },
  { id: 'model-smart', name: 'Model Smart', enabled: true },
]

function singleCase(conditions: ConditionRule[] = [{ fieldPath: 'request.body.tenant', valueType: 'string', operator: 'startsWith', value: 'vip-' }]): ConditionCase {
  return { id: 'case-1', name: '分支 1', logicalOperator: 'and', conditions }
}

type BaseNodeOverrides = {
  input?: Partial<Extract<WorkflowNodeModel, { kind: 'input' }>>
  control?: Partial<Extract<WorkflowNodeModel, { kind: 'control-input' }>>
  protocol?: Partial<Extract<WorkflowNodeModel, { kind: 'protocol-discovery' }>>
  condition?: Partial<Extract<WorkflowNodeModel, { kind: 'condition' }>>
  modelSelect?: Partial<Extract<WorkflowNodeModel, { kind: 'model-select' }>>
}

function createBaseGraph(overrides?: BaseNodeOverrides): WorkflowGraph {
  const conditionNode: Extract<WorkflowNodeModel, { kind: 'condition' }> = {
    id: 'condition-gate', kind: 'condition', name: '租户准入判断', enabled: true, description: '仅放行 vip 租户', position: { x: 480, y: 120 }, cases: [singleCase()], ...overrides?.condition,
  }
  const controlNode: Extract<WorkflowNodeModel, { kind: 'control-input' }> = {
    id: 'control-input', kind: 'control-input', name: '控制输入', enabled: true, description: '注入系统控制值', position: { x: 250, y: 120 },
    controls: [{ id: 'feature-toggle', key: 'featureEnabled', label: '功能开关', kind: 'switch', enabled: true, defaultValue: true }], ...overrides?.control,
  }
  const modelSelectNode: Extract<WorkflowNodeModel, { kind: 'model-select' }> = {
    id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '选择逻辑模型', position: { x: 780, y: 120 }, source: 'fixed', variablePath: '', modelIds: ['model-vip', 'model-default'], fallbackModelIds: [], ...overrides?.modelSelect,
  }
  const nodes: WorkflowNodeModel[] = [
    { id: 'input', kind: 'input', name: '输入', enabled: true, description: '输入标准化', position: { x: 60, y: 120 }, ...overrides?.input }, controlNode,
    { id: 'protocol', kind: 'protocol-discovery', name: '协议发现', enabled: true, description: '识别请求协议并分发分支', position: { x: 250, y: 120 }, ...overrides?.protocol }, conditionNode, modelSelectNode,
    { id: 'output', kind: 'output', name: '输出', enabled: true, description: '路由结果输出', position: { x: 1050, y: 120 }, includeTrace: true, summaryLevel: 'detailed' },
  ]
  return { version: 1, nodes, edges: [
    edge('input', 'out', 'control-input'),
    edge('control-input', 'out', 'protocol'),
    edge('protocol', 'openai-completions', 'condition-gate'),
    edge('protocol', 'openai-responses', 'condition-gate'),
    edge('protocol', 'anthropic-messages', 'condition-gate'),
    edge('protocol', 'unknown', 'output'),
    edge('condition-gate', 'case-1', 'model-select'),
    edge('condition-gate', 'else', 'output'),
    edge('model-select', 'out', 'output'),
  ] }
}

describe('router engine', () => {
  it('normalizes protocol branch payloads with model and messages for downstream outputs', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello world' }],
        },
      },
      metadata: { source: 'desktop' },
    })

    // 协议归一化的结果只进 trace 详情，不再写回 payload。
    const protocolTrace = result.trace.find(item => item.nodeId === 'protocol')
    expect(protocolTrace?.details).toMatchObject({
      normalized: {
        protocol: 'openai-completions',
        transport: 'http',
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello world' }],
      },
    })
    // 调用方的 metadata 不被引擎改写。
    const payload = result.outputPayload as { metadata: Record<string, unknown> }
    expect(payload.metadata).toEqual({ source: 'desktop' })
  })

  it('把增量的客户端意图记成一档传输形态', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: {
          'x-provider': 'openai',
          accept: 'text/event-stream',
        },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
          stream: true,
        },
      },
      metadata: {},
    })

    // 变的只是客户端想怎么收字节，所以是轴上的另一个取值 `http-stream`，
    // 而不是「HTTP 连接 + 流式交付」的乘积，也不是一个 `http-sse` 之类的词。
    const payload = result.outputPayload as { route: { protocol: string; transport: string } }
    expect(payload.route.transport).toBe('http-stream')
    expect(payload.route.protocol).toBe('openai-completions')
  })

  it('优先采信调用方声明的传输形态', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: { tenant: 'vip-cn', model: 'gpt-4o-mini' },
      },
      protocol: 'openai-completions',
      transport: 'websocket',
      metadata: {},
    })

    const payload = result.outputPayload as { route: { transport: string } }
    expect(payload.route.transport).toBe('websocket')
  })

  it('routes openai-completions requests through IF and resolver nodes', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: { source: 'desktop' },
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('openai-completions')
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('injects control-input values into route.controls for downstream conditions', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{ 
          fieldPath: 'route.controls.featureEnabled',
          valueType: 'boolean',
          operator: 'isTrue',
        }])],
      },
      control: {
        controls: [
          {
            id: 'feature-toggle',
            key: 'featureEnabled',
            label: '功能开关',
            kind: 'switch',
            enabled: true,
            defaultValue: true,
          },
        ],
      },
    })

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'standard-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    const payload = result.outputPayload as { route: { controls: { featureEnabled: boolean } } }
    expect(payload.route.controls.featureEnabled).toBe(true)
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('auto-detects anthropic-messages by model id without explicit rules', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/messages',
        headers: {},
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('anthropic-messages')
  })

  it('supports request.headers as string array when discovering protocol', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('openai-completions')
  })

  it('用通用条件判断请求模型是否在可用逻辑模型里', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{
          fieldPath: 'request.body.model',
          valueType: 'string',
          operator: 'in',
          valueSource: 'field',
          valueFieldPath: 'logicalModels[*].id',
        }])],
      },
      modelSelect: {
        modelIds: ['model-hit'],
      },
    })

    const logicalModels = [
      { id: 'model-hit', name: 'Model Hit', enabled: true },
      { id: 'model-fallback', name: 'Model Fallback', enabled: true },
    ]

    const hit = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'model-hit' },
      },
      logicalModels,
      metadata: {},
    })

    expect(hit.stopReason).toBe('output')
    expect(hit.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-hit'] }])
    expect(hit.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)

    const miss = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'gpt-4o-mini' },
      },
      logicalModels,
      metadata: {},
    })

    expect(miss.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)

    const payload = hit.outputPayload as { request: { body: { model: string } }; route: Record<string, unknown> }
    // `route` 只装「决策结果 + 不可推导的一手事实」，其余一律不落：请求模型就是请求自己的字段
    // （`request.body.model`），「可用逻辑模型 id」用 `logicalModels[*].id` 投影现算。
    // 用整键集合断言（而不是逐个 not.toContain）：将来任何新派生字段加进来都会在这里现形。
    expect(Object.keys(payload.route).sort()).toEqual(['controls', 'fallback', 'modelIds', 'protocol', 'traceId', 'transport'])
    expect(payload.request.body.model).toBe('model-hit')
  })

  it('字段右值：比较字段取不到值时按空集合判定', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{
          fieldPath: 'request.body.model',
          valueType: 'string',
          operator: 'in',
          valueSource: 'field',
          valueFieldPath: 'route.neverSet',
        }])],
      },
    })

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    expect(result.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)
    expect(result.nodeOutputs).not.toHaveProperty('model-select')
  })

  it('字段右值：notIn 在比较字段取不到值时判定为真', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{
          fieldPath: 'request.body.model',
          valueType: 'string',
          operator: 'notIn',
          valueSource: 'field',
          valueFieldPath: 'route.neverSet',
        }])],
      },
      modelSelect: {
        modelIds: ['model-x'],
      },
    })

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-x'] }])
  })

  it('exposes protocol discovery results for downstream conditions', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([
          {
            fieldPath: 'route.protocol',
            valueType: 'string',
            operator: 'equals',
            value: 'openai-completions',
          },
          {
            fieldPath: 'request.body.messages',
            valueType: 'array',
            operator: 'notEmpty',
          },
        ])],
      },
    })

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello world' }],
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('sends unknown protocol directly to output branch', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v2/unknown',
        headers: {},
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('unknown')
    expect(result.nodeOutputs).not.toHaveProperty('model-select')
  })

  it('按节点 id 聚合节点输出，同名节点各占一组', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: { tenant: 'vip-cn', model: 'model-vip' },
      },
      logicalModels: [{ id: 'model-vip', name: 'VIP', enabled: true }],
      metadata: {},
    })

    // 输出数据挂在节点 id 上，每个节点可以有多条；渲染侧再查名称作分组标题。
    expect(new Set(Object.keys(result.nodeOutputs))).toEqual(new Set(['input', 'control-input', 'protocol', 'condition-gate', 'model-select', 'output']))
    expect(result.nodeOutputs.input).toEqual([
      { name: '逻辑模型', value: ['model-vip'] },
    ])
    expect(result.nodeOutputs['control-input']).toEqual([{ name: '功能开关', value: true, note: 'featureEnabled' }])
    expect(result.nodeOutputs.protocol).toEqual([
      { name: '协议', value: 'openai-completions' },
      { name: '传输形态', value: 'http' },
      { name: '请求模型', value: 'model-vip' },
    ])
    expect(result.nodeOutputs['condition-gate']).toEqual([{ name: '分支 1', value: '命中' }])
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(result.nodeOutputs.output).toEqual([{ name: '最终落点', value: ['model-vip', 'model-default'] }])
  })

  it('请求模型由协议发现节点报出，输入节点不读请求体', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels: [{ id: 'model-vip', name: 'VIP', enabled: true }],
      metadata: {},
    })

    // 体里明明白白写着模型名，输入节点也不读它：它只报自己保证得了的 `logicalModels`。
    // 「模型名写在哪」是协议层的事实，读出来的是协议发现节点（下一条断言）。
    expect(result.nodeOutputs.input).toEqual([{ name: '逻辑模型', value: ['model-vip'] }])
    expect(result.nodeOutputs.protocol?.find(item => item.name === '请求模型')).toEqual({ name: '请求模型', value: 'gpt-4o-mini' })
  })

  it('归一化视图按协议声明读请求体：responses 的消息在 input 里', async () => {
    const graph = createBaseGraph()

    // 体里同时放了 `messages` 与 `input`：谁才是真消息由**协议声明**说了算。
    // 靠「先找 messages、找不到再找 input」的兜底顺序会在这里读错 —— 而那个顺序
    // 正是声明表的第二份副本，换个协议就静默跑偏（见 request-shape.ts 的 `requestBodyField`）。
    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/responses',
        headers: {},
        body: {
          model: 'gpt-5',
          messages: [{ role: 'user', content: '不该被读' }],
          input: [{ role: 'user', content: '真正要读的' }],
        },
      },
      logicalModels: [{ id: 'model-vip', name: 'VIP', enabled: true }],
      metadata: {},
    })

    expect(result.trace.find(item => item.nodeId === 'protocol')?.details).toMatchObject({
      normalized: {
        protocol: 'openai-responses',
        model: 'gpt-5',
        messages: [{ role: 'user', content: '真正要读的' }],
      },
    })
  })

  it('认不出协议时协议发现节点如实给出空模型名，不按别的协议猜', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: { path: '/v1/unknown-endpoint', headers: {}, body: { model: 'text-embedding-3' } },
      logicalModels: [],
      metadata: {},
    })

    // 认不出协议就一个字段都保证不了：体里那个 `model` 照旧不认账，也不退回某一种协议的路径。
    expect(result.nodeOutputs.protocol).toEqual([
      { name: '协议', value: 'unknown' },
      { name: '传输形态', value: 'http' },
      { name: '请求模型', value: '' },
    ])
  })

  it('保留条件命中后的逻辑模型选择结果', async () => {
    const graph = createBaseGraph()

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'unknown-model',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
  })

  it('保留逻辑模型选择节点的稳定结果', async () => {
    const result = await runWorkflow(createBaseGraph(), {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'model-vip',
        },
      },
      metadata: {},
    })

    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
  })

  it('returns an error when the input node is missing', async () => {
    const graph = createBaseGraph()
    graph.nodes = graph.nodes.filter(node => node.kind !== 'input')

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('error')
    expect(result.nodeOutputs).toEqual({})
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]?.message).toBe('缺少输入节点')
  })

  it('skips a disabled protocol-discovery node and follows the unknown branch', async () => {
    const graph = createBaseGraph({
      protocol: {
        enabled: false,

      },
    })

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('unknown')
    expect(result.nodeOutputs).not.toHaveProperty('model-select')
    expect(result.trace.some(item => item.nodeId === 'protocol' && item.message === '节点禁用，跳过')).toBe(true)
  })

  it('不生成旧的扁平路由字段', async () => {
    const graph = createBaseGraph()
    graph.edges = graph.edges.map(item => item.sourceNodeId === 'protocol' && item.sourcePort === 'unknown' ? { ...item, targetNodeId: 'condition-gate' } : item)

    const result = await runWorkflow(graph, {
      request: {
        path: '/v2/unknown',
        headers: {},
        body: { tenant: 'vip-cn', model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(result).not.toHaveProperty('routeDecision')
  })

  it('supports multiple IF branches with OR and ELSE fallback', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [
          singleCase([{ fieldPath: 'request.body.tenant', valueType: 'string', operator: 'equals', value: 'vip-cn' }]),
          {
            id: 'case-2',
            name: '高优先级',
            logicalOperator: 'or',
            conditions: [
              { fieldPath: 'request.body.priority', valueType: 'number', operator: 'gte', value: '5' },
              { fieldPath: 'request.body.tenant', valueType: 'string', operator: 'equals', value: 'internal' },
            ],
          },
        ],
      },
    })

    graph.edges.push(edge('condition-gate', 'case-2', 'model-select'))

    const result = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: { tenant: 'internal', priority: 1, model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    const conditionTrace = result.trace.find(item => item.nodeId === 'condition-gate')
    expect(result.stopReason).toBe('output')
    expect(conditionTrace?.success).toBe(true)
    expect(conditionTrace?.details).toMatchObject({ matchedCaseId: 'case-2' })
  })

  it('supports numeric between condition operator', async () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{ 
          fieldPath: 'request.body.priority',
          valueType: 'number',
          operator: 'between',
          value: '1',
          secondaryValue: '3',
        }])],
      },
    })

    const pass = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          priority: 2,
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    const fail = await runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          priority: 6,
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(pass.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(fail.nodeOutputs).not.toHaveProperty('model-select')
    expect(fail.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)
  })

  it('迭代节点遍历数组并在完成后从 out 端口退出', async () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position: { x: 100, y: 0 }, source: 'fixed', variablePath: '', modelIds: ['model-a', 'model-b'], fallbackModelIds: [] },
      { id: 'control', kind: 'control-input', name: '下游', enabled: true, description: '', position: { x: 200, y: 0 }, controls: [] },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = await runWorkflow({ version: 1, nodes, edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'control'), edge('control', 'out', 'output')] }, { request: { body: { items: ['a', 'b', 'c'] } }, metadata: {} })
    expect(result.stopReason).toBe('output')
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-a', 'model-b'] }])
    expect((result.outputPayload as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('iteration')
  })

  it('逻辑模型选择节点去重并保持选择顺序', async () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position: { x: 100, y: 0 }, source: 'fixed', variablePath: '', modelIds: ['model-a', 'model-a', 'model-b'], fallbackModelIds: [] },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = await runWorkflow({ version: 1, nodes, edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'output')] }, { request: { body: {} }, metadata: {} })
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-a', 'model-b'] }])
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-a', 'model-b'])
  })

  it('默认策略（基础节点组合）：请求模型是逻辑模型时直连该逻辑模型', async () => {
    const logicalModels = [
      { id: 'model-hit', name: 'Model Hit', enabled: true },
      { id: 'default', name: 'Default', enabled: true },
    ]
    const result = await runWorkflow(createDefaultPolicyGraph(logicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'model-hit' } },
      logicalModels,
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    expect(result.nodeOutputs['model-direct']).toEqual([
      { name: '取值字段', value: 'request.body.model' },
      { name: '落点逻辑模型', value: ['model-hit'] },
    ])
    expect(payload.route.modelIds).toEqual(['model-hit'])
    expect(payload.route.fallback).toBe(false)
    expect(result.trace.some(item => item.nodeId === 'condition' && item.success)).toBe(true)
  })

  it('默认策略（基础节点组合）：请求模型不是逻辑模型时落到默认逻辑模型', async () => {
    const logicalModels = [
      { id: 'model-hit', name: 'Model Hit', enabled: true },
      { id: 'default', name: 'Default', enabled: true },
    ]
    const result = await runWorkflow(createDefaultPolicyGraph(logicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[] } }
    expect(result.nodeOutputs['model-default']).toEqual([{ name: '落点逻辑模型', value: ['default'] }])
    expect(payload.route.modelIds).toEqual(['default'])
    expect(result.nodeOutputs).not.toHaveProperty('model-direct')
    expect(result.trace.some(item => item.nodeId === 'condition' && !item.success)).toBe(true)
  })

  it('UA 分流模板：按头值里的客户端标识落到不同逻辑模型', async () => {
    const cursor = await runWorkflow(createUserAgentGraph(presetLogicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'content-type': 'application/json', 'user-agent': 'Cursor/0.42.3' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: presetLogicalModels,
      metadata: {},
    })
    const cursorPayload = cursor.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    // 落点在生成时按逻辑模型列表定好：第一个分流落点拿到 `default` 之外的头一个。
    expect(cursorPayload.route.modelIds).toEqual(['model-fast'])
    expect(cursorPayload.route.fallback).toBe(false)
    // content-type 先被扫过、user-agent 第二个命中：跑满两轮后提前收工（对象模式的 key 就是头名）。
    expect(cursor.trace.find(item => item.nodeId === 'iteration')?.details)
      .toMatchObject({ sourcePath: 'request.headers', itemCount: 2, executed: 2, hitCount: 1, hitKeys: ['user-agent'] })

    const claudeCli = await runWorkflow(createUserAgentGraph(presetLogicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'user-agent': 'claude-cli/1.0.0 (external, cli)' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: presetLogicalModels,
      metadata: {},
    })
    expect((claudeCli.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-smart'])
  })

  it('UA 分流模板：头名大小写不影响判定，认不出的来源回落默认', async () => {
    // 遍历的是头值，所以 `User-Agent` 这种大写头名照样能识别出客户端。
    const mixedCase = await runWorkflow(createUserAgentGraph(presetLogicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'User-Agent': 'Cursor/0.42.3' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: presetLogicalModels,
      metadata: {},
    })
    expect((mixedCase.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-fast'])

    const unknown = await runWorkflow(createUserAgentGraph(presetLogicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'user-agent': 'curl/8.4.0' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: presetLogicalModels,
      metadata: {},
    })
    const unknownPayload = unknown.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    expect(unknownPayload.route.modelIds).toEqual(['default'])
    expect(unknownPayload.route.fallback).toBe(true)
    // resultPath 留空：整轮没命中时汇总结果不能把 route.modelIds 覆盖成空数组。
    expect(unknown.trace.find(item => item.nodeId === 'iteration')?.details)
      .toMatchObject({ executed: 1, hitCount: 0, hitKeys: [], resultPath: '' })
  })

  it('UA 分流模板：循环由回边闭合，out 端口通向兜底链路', () => {
    const graph = createUserAgentGraph(presetLogicalModels)
    expect(WorkflowGraphSchema.safeParse(graph).error?.issues).toBeUndefined()

    const iteration = graph.nodes.find(node => node.kind === 'iteration')
    expect(iteration).toBeDefined()
    // 从 body 端口进循环体，末端能回到迭代节点本身，说明循环是闭合的。
    const backEdges = graph.edges.filter(item => item.targetNodeId === iteration?.id && item.sourceNodeId !== 'input')
    expect(backEdges.map(item => item.sourceNodeId).sort()).toEqual(['model-claude-cli', 'model-cursor', 'ua-condition'])
    // 循环体外还有 out 端口通向出口链路。
    expect(graph.edges.some(item => item.sourceNodeId === iteration?.id && item.sourcePort === 'out')).toBe(true)
  })

  it('LLM 分流模板：让逻辑模型判定复杂度，回复命中「复杂」就走高性能落点', async () => {
    const invocations: PromptInvocation[] = []
    const result = await runWorkflow(createLlmComplexityGraph(presetLogicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '帮我重构这个模块' }] } },
      logicalModels: presetLogicalModels,
      metadata: {},
    }, {
      capabilities: {
        runPrompt: async (invocation) => {
          invocations.push(invocation)
          return { success: true, text: 'Complex', target: 'openai/gpt-4o-mini', durationMilliseconds: 88 }
        },
      },
    })

    expect(invocations).toHaveLength(1)
    // LLM 节点的判定模型用的是兜底落点（内建默认逻辑模型）。
    expect(invocations[0].logicalModelId).toBe('default')
    // 请求体整体插值进提示词，且不会把 `${...}` 原样发给上游。
    expect(invocations[0].prompt).toContain('帮我重构这个模块')
    expect(invocations[0].prompt).not.toContain('${')
    expect(invocations[0].temperature).toBe(0.2)

    const payload = result.outputPayload as { route: { modelIds: string[]; complexity: string } }
    expect(payload.route.complexity).toBe('Complex')
    // 条件用不锚定首尾的正则匹配，首字母大写的回复照样命中。
    expect(payload.route.modelIds).toEqual(['model-fast'])
    expect(result.nodeOutputs).not.toHaveProperty('model-simple')
    expect(result.stopReason).toBe('output')
  })

  it('LLM 分流模板：回答认不出来、或 LLM 不可用时都走「其余」落点', async () => {
    const input = {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '你好' }] } },
      logicalModels: presetLogicalModels,
      metadata: {},
    }

    const simple = await runWorkflow(createLlmComplexityGraph(presetLogicalModels), input, {
      capabilities: { runPrompt: async () => ({ success: true, text: 'simple', durationMilliseconds: 12 }) },
    })
    expect((simple.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-smart'])

    // 没注入执行能力时 LLM 节点记为失败，但整张图仍然走到出口。
    const unavailable = await runWorkflow(createLlmComplexityGraph(presetLogicalModels), input)
    expect(unavailable.trace.find(item => item.nodeId === 'complexity-prompt')?.success).toBe(false)
    expect((unavailable.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-smart'])
    expect(unavailable.stopReason).toBe('output')
  })

  it('JS 分流模板：脚本的打分结果决定落点', async () => {
    const invocations: ScriptInvocation[] = []
    const input = {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: presetLogicalModels,
      metadata: {},
    }
    const complex = await runWorkflow(createScriptRoutingGraph(presetLogicalModels), input, {
      capabilities: {
        runScript: async (invocation) => {
          invocations.push(invocation)
          return { success: true, value: 'complex', logs: ['复杂度打分'], durationMilliseconds: 3 }
        },
      },
    })

    expect(invocations).toHaveLength(1)
    // 脚本读的是消息列表与工具数：消息列表在哪由协议决定（先读 `route.protocol`），
    // 缺字段时自己兜住，不依赖调用方一定传全。
    expect(invocations[0].code).toContain("'request.body.messages'")
    expect(invocations[0].code).toContain("get('route.protocol')")
    expect(invocations[0].code).toContain("get('request.body.tools')")
    expect((complex.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-fast'])
    expect(complex.nodeOutputs).not.toHaveProperty('model-simple')
    expect(complex.stopReason).toBe('output')

    const simple = await runWorkflow(createScriptRoutingGraph(presetLogicalModels), input, {
      capabilities: { runScript: async () => ({ success: true, value: 'simple', logs: [], durationMilliseconds: 2 }) },
    })
    expect((simple.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-smart'])
  })

  it('JS 分流模板：脚本失败时落点仍然落到「其余」，图照常走完', async () => {
    const failed = await runWorkflow(createScriptRoutingGraph(presetLogicalModels), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: presetLogicalModels,
      metadata: {},
    }, {
      capabilities: { runScript: async () => ({ success: false, logs: [], error: '脚本执行超时', durationMilliseconds: 2_000 }) },
    })

    expect(failed.trace.find(item => item.nodeId === 'complexity-script')?.success).toBe(false)
    expect((failed.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-smart'])
    expect(failed.stopReason).toBe('output')
  })

  it('内置策略都按当前实现报数：入口节点只报逻辑模型，请求模型由协议发现节点报', async () => {
    // 「内置策略有没有跟上新实现」的机器判据：
    // - 请求体字段任何策略都不许从入口节点出来（那是协议层的知识）；
    // - 链路里有协议发现节点的策略，必须真的报出这次请求的模型名。
    // 少了这一条，预设可以一直「长得像」，跑起来却是空的。
    for (const preset of ROUTER_POLICY_PRESETS) {
      const graph = preset.createGraph(presetLogicalModels)
      const result = await runWorkflow(graph, {
        request: { path: '/v1/chat/completions', headers: { 'user-agent': 'Cursor/0.42.3' }, body: { model: 'gpt-4o-mini' } },
        logicalModels: presetLogicalModels,
        metadata: {},
      })

      expect({ id: preset.id, input: result.nodeOutputs.input }).toEqual({
        id: preset.id,
        input: [{ name: '逻辑模型', value: presetLogicalModels.map(model => model.id) }],
      })

      if (!graph.nodes.some(node => node.kind === 'protocol-discovery')) continue
      expect({ id: preset.id, protocolModel: result.nodeOutputs.protocol?.find(item => item.name === '请求模型') }).toEqual({
        id: preset.id,
        protocolModel: { name: '请求模型', value: 'gpt-4o-mini' },
      })
    }
  })

  it('变量取值：字段为空时回落到兜底逻辑模型', async () => {
    const result = await runWorkflow(createVariableModelGraph('model-fallback'), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: '' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'request.body.model' },
      { name: '落点逻辑模型', value: ['model-fallback'], note: '兜底' },
    ])
    expect(payload.route.modelIds).toEqual(['model-fallback'])
    expect(payload.route.fallback).toBe(true)
  })

  it('变量取值：字段是通配投影数组时整体作为落点', async () => {
    const graph = createVariableModelGraph()
    graph.nodes = graph.nodes.map(node => node.kind === 'model-select'
      ? { ...node, variablePath: 'logicalModels[*].id' }
      : node)

    const result = await runWorkflow(graph, {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: [
        { id: 'model-a', name: 'Model A', enabled: true },
        { id: 'model-b', name: 'Model B', enabled: true },
      ],
      metadata: {},
    })

    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'logicalModels[*].id' },
      { name: '落点逻辑模型', value: ['model-a', 'model-b'] },
    ])
  })

  it('变量取值：请求模型是逻辑模型名称时落到它的 id', async () => {
    // 条件按 `logicalModels[*].name` 命中、落点取同一个字段：客户端的模型名与逻辑模型 id
    // 不同名时（这里是 `deepseek-v4.1-flash` / `deepseek-v4-1-flash`）不能落到空。
    const result = await runWorkflow(createVariableModelGraph(), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'deepseek-v4.1-flash' } },
      logicalModels: [{ id: 'deepseek-v4-1-flash', name: 'deepseek-v4.1-flash', enabled: true }],
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'request.body.model' },
      { name: '落点逻辑模型', value: ['deepseek-v4-1-flash'] },
    ])
    expect(payload.route.modelIds).toEqual(['deepseek-v4-1-flash'])
    expect(payload.route.fallback).toBe(false)
    // 取值与落点不同名时，节点说明要如实交代这层翻译，而不是让用户自己猜 id 从哪来。
    expect(result.trace.find(item => item.nodeId === 'model-select')?.message)
      .toBe('字段 request.body.model 取值 deepseek-v4.1-flash，按名称指向逻辑模型 deepseek-v4-1-flash')
  })

  it('变量取值：取值已经是逻辑模型 id 时原样直连', async () => {
    const result = await runWorkflow(createVariableModelGraph(), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'model-hit' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    expect(result.trace.find(item => item.nodeId === 'model-select')?.message)
      .toBe('字段 request.body.model 取值 model-hit，直连该逻辑模型')
  })

  it('变量取值：头名大小写不敏感，与条件读同一套字段解析', async () => {
    // 条件里 `request.headers.<名字>` 按头名大小写不敏感；落点取同一个路径时不能因为
    // 写法大小写不同就读成「字段不存在」，否则同一条路径两边对不上。
    const graph = createVariableModelGraph()
    graph.nodes = graph.nodes.map(node => node.kind === 'model-select'
      ? { ...node, variablePath: 'request.headers.X-Model-Id' }
      : node)

    const result = await runWorkflow(graph, {
      request: { path: '/v1/chat/completions', headers: { 'x-model-id': 'model-hit' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[] } }
    expect(payload.route.modelIds).toEqual(['model-hit'])
  })

  it('变量取值：没有兜底逻辑模型且取不到值时落点为空', async () => {
    const result = await runWorkflow(createVariableModelGraph(), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: '' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'request.body.model' },
      { name: '落点逻辑模型', value: [] },
    ])
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual([])
    expect(result.trace.some(item => item.nodeId === 'output' && !item.success)).toBe(true)
  })
})

/* ------------------------------------------------------------------------- *
 * 类型感知的条件判定（对象 / 数组 / 未知类型）
 * ------------------------------------------------------------------------- */

/** 用一个条件规则跑一遍完整图，只关心条件节点是否命中。 */
function runConditionProbe(rule: ConditionRule, body: Record<string, unknown>) {
  const graph = createBaseGraph({ condition: { cases: [singleCase([rule])] } })
  return runWorkflow(graph, {
    request: {
      path: '/v1/chat/completions',
      headers: { 'x-provider': 'openai' },
      body: { tenant: 'vip-cn', model: 'gpt-4o-mini', ...body },
    },
    metadata: {},
  })
}

async function conditionHit(rule: ConditionRule, body: Record<string, unknown>): Promise<boolean> {
  const result = await runConditionProbe(rule, body)
  return Boolean(result.trace.find(item => item.nodeId === 'condition-gate')?.success)
}

describe('router engine · 类型感知条件', () => {
  const rule = (patch: Partial<ConditionRule>): ConditionRule => ({
    fieldPath: 'request.body.tags',
    valueType: 'object',
    operator: 'notEmpty',
    valueSource: 'literal',
    valueFieldPath: '',
    ...patch,
  })

  it('对象按键名判定包含，空对象按无键判定为空', async () => {
    expect(await conditionHit(rule({ operator: 'contains', value: 'tier' }), { tags: { tier: 'gold' } })).toBe(true)
    expect(await conditionHit(rule({ operator: 'contains', value: 'tier' }), { tags: { region: 'cn' } })).toBe(false)
    expect(await conditionHit(rule({ operator: 'empty' }), { tags: {} })).toBe(true)
    expect(await conditionHit(rule({ operator: 'empty' }), { tags: { region: 'cn' } })).toBe(false)
    expect(await conditionHit(rule({ operator: 'notEmpty' }), { tags: { region: 'cn' } })).toBe(true)
    // undefined 与空对象都算空；不能把它们字符串化成 "[object Object]" 再判。
    expect(await conditionHit(rule({ operator: 'empty' }), {})).toBe(true)
  })

  it('数组按长度判空、按元素判包含', async () => {
    const arrayRule = rule({ fieldPath: 'request.body.list', valueType: 'array' })
    expect(await conditionHit(arrayRule, { list: [] })).toBe(false)
    expect(await conditionHit({ ...arrayRule, operator: 'empty' }, { list: [] })).toBe(true)
    expect(await conditionHit({ ...arrayRule, operator: 'notEmpty' }, { list: ['vip'] })).toBe(true)
    expect(await conditionHit({ ...arrayRule, operator: 'contains', value: 'vip' }, { list: ['vip', 'cn'] })).toBe(true)
    expect(await conditionHit({ ...arrayRule, operator: 'contains', value: 'v' }, { list: ['vip'] })).toBe(false)
    expect(await conditionHit({ ...arrayRule, operator: 'notContains', value: 'v' }, { list: ['vip'] })).toBe(true)
  })

  it('对象按结构化序列化比较相等', async () => {
    const equalRule = rule({ operator: 'equals', value: '{"tier":"gold"}' })
    expect(await conditionHit(equalRule, { tags: { tier: 'gold' } })).toBe(true)
    expect(await conditionHit(equalRule, { tags: { tier: 'silver' } })).toBe(false)
    expect(await conditionHit({ ...equalRule, operator: 'notEquals' }, { tags: { tier: 'silver' } })).toBe(true)
  })

  it('未知类型不限制操作符，运行时按实际取值决定语义', async () => {
    // valueType 是 unknown（例如数组元素、动态脚本产出），仍然可以用数值比较。
    expect(await conditionHit(rule({ fieldPath: 'request.body.priority', valueType: 'unknown', operator: 'gt', value: '3' }), { priority: 5 })).toBe(true)
    expect(await conditionHit(rule({ fieldPath: 'request.body.priority', valueType: 'unknown', operator: 'gt', value: '3' }), { priority: 1 })).toBe(false)
    expect(await conditionHit(rule({ fieldPath: 'request.body.tags', valueType: 'unknown', operator: 'contains', value: 'tier' }), { tags: { tier: 'gold' } })).toBe(true)
  })
})

/* ------------------------------------------------------------------------- *
 * 遍历迭代
 * ------------------------------------------------------------------------- */

type IterationOverrides = {
  iteration?: Partial<Extract<WorkflowNodeModel, { kind: 'iteration' }>>
  /** 循环体直接从迭代节点连回自身（不经过任何节点），用于验证「空循环体」的最小闭合。 */
  withBody?: false
}

/**
 * 遍历迭代图：输入 → 遍历迭代 →（body）条件筛选 → 取值 → 回到迭代；迭代 → 输出。
 * 循环体是「手动回边」那一套：从 body 端口出去，末端连回迭代节点即本轮结束。
 */
function createIterationGraph(overrides?: IterationOverrides): WorkflowGraph {
  const nodes: WorkflowNodeModel[] = [
    { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
    {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历迭代',
      enabled: true,
      description: '',
      position: { x: 200, y: 0 },
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
      ...overrides?.iteration,
    },
    {
      id: 'body-condition',
      kind: 'condition',
      name: '本轮是否启用',
      enabled: true,
      description: '',
      position: { x: 400, y: 0 },
      cases: [singleCase([{
        fieldPath: 'route.iteration.item.enabled',
        valueType: 'boolean',
        operator: 'isTrue',
        valueSource: 'literal',
        valueFieldPath: '',
        value: '',
      }])],
    },
    {
      id: 'body-model',
      kind: 'model-select',
      name: '取本轮模型 id',
      enabled: true,
      description: '',
      position: { x: 600, y: 0 },
      source: 'variable',
      variablePath: 'route.iteration.item.id',
      modelIds: [],
      fallbackModelIds: [],
    },
    { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 800, y: 0 }, includeTrace: true, summaryLevel: 'detailed' },
  ]

  const edges = [
    edge('input', 'out', 'iteration'),
    edge('iteration', 'out', 'output'),
  ]
  if (overrides?.withBody !== false) {
    edges.push(
      edge('iteration', 'body', 'body-condition'),
      edge('body-condition', 'case-1', 'body-model'),
      // 循环体末端连回迭代节点：这一条边代表「本轮结束」。
      edge('body-model', 'out', 'iteration'),
      edge('body-condition', 'else', 'iteration'),
    )
  }

  return { version: 1, nodes, edges }
}

const logicalModels = [
  { id: 'model-off', name: 'Off', enabled: false },
  { id: 'model-on', name: 'On', enabled: true },
  { id: 'model-later', name: 'Later', enabled: true },
]

describe('router engine · 遍历迭代', () => {
  it('数组来源：逐项跑循环体，首次命中即停止并写回结果', async () => {
    const result = await runWorkflow(createIterationGraph(), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.success).toBe(true)
    expect(iterationTrace?.details).toMatchObject({
      sourcePath: 'logicalModels',
      collectMode: 'first',
      itemCount: 3,
      executed: 2,
      hitCount: 1,
      hitKeys: ['1'],
    })

    expect(result.nodeOutputs.iteration).toEqual([
      { name: '第 1 轮（0）', value: '未命中', note: 'route.modelIds' },
      { name: '第 2 轮（1）', value: ['model-on'] },
      { name: '遍历轮数', value: 2 },
      { name: '汇总结果', value: ['model-on'] },
    ])

    // 汇总结果写回 collectPath / resultPath，下游照常可以读 route.modelIds。
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-on'])
  })

  it('对象来源按「键值对」遍历，route.iteration.key 是键名', async () => {
    const result = await runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'metadata.tags', collectPath: 'route.iteration.item', collectMode: 'last', resultPath: 'route.iterationResult' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      metadata: { tags: { gold: 'a', vip: 'b' } },
    })

    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.details).toMatchObject({ itemCount: 2, executed: 2, hitKeys: ['gold', 'vip'] })

    // `last` 模式保留最后一个命中值；收集路径读取的是本轮作用域，所以每轮都命中。
    const payload = result.outputPayload as { route: { iterationResult: unknown; iteration: { key: string } } }
    expect(payload.route.iterationResult).toBe('b')
    expect(payload.route.iteration.key).toBe('vip')
  })

  it('count 模式只累计轮数，不受收集路径是否命中影响', async () => {
    const result = await runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'metadata.tags', collectPath: 'route.modelIds', collectMode: 'count', resultPath: 'route.iterationCount' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      metadata: { tags: { a: 1, b: 2, c: 3 } },
    })

    const payload = result.outputPayload as { route: { iterationCount: number } }
    expect(payload.route.iterationCount).toBe(3)
    expect(result.trace.find(item => item.nodeId === 'iteration')?.details).toMatchObject({ executed: 3, hitCount: 0 })
  })

  it('list 模式收集每轮命中值', async () => {
    // 让循环体每轮都命中：收集路径改读本轮作用域里的 enabled。
    const result = await runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'logicalModels[*].id', collectPath: 'route.iteration.item', collectMode: 'list', resultPath: 'route.hitIds' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    // 通配投影把对象数组拍平成 id 数组，遍历的是字符串元素。
    const payload = result.outputPayload as { route: { hitIds: string[] } }
    expect(payload.route.hitIds).toEqual(['model-off', 'model-on', 'model-later'])
    expect(result.trace.find(item => item.nodeId === 'iteration')?.details).toMatchObject({ sourcePath: 'logicalModels[*].id', executed: 3 })
  })

  it('轮数上限生效，未遍历完的项会记录在 trace 里', async () => {
    const result = await runWorkflow(createIterationGraph({
      iteration: { maxIterations: 1, collectMode: 'list' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.details).toMatchObject({ executed: 1, itemCount: 3 })
    expect(String(iterationTrace?.details?.stoppedReason)).toContain('迭代上限')
  })

  it('没有连接循环体时不执行任何一轮，但仍把空结果写回', async () => {
    const result = await runWorkflow(createIterationGraph({ withBody: false }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.success).toBe(false)
    expect(iterationTrace?.details).toMatchObject({ bodyConnected: false, executed: 0 })
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual([])
    // 遍历不成立也要继续往下走，落到出口节点。
    expect(result.stopReason).toBe('output')
  })

  it('遍历来源为空时执行 0 轮，不进入循环体', async () => {
    const result = await runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'metadata.missing', collectMode: 'count', resultPath: 'route.iterationCount' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      metadata: {},
    })

    expect(result.trace.find(item => item.nodeId === 'iteration')?.details).toMatchObject({ itemCount: 0, executed: 0 })
    expect((result.outputPayload as { route: { iterationCount: number } }).route.iterationCount).toBe(0)
    expect(result.nodeOutputs['body-condition']).toBeUndefined()
  })
})


/** 最小变量取值图：输入 → 逻辑模型选择（读取 request.body.model）→ 输出。 */
function createVariableModelGraph(fallbackModelId?: string): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      {
        id: 'model-select',
        kind: 'model-select',
        name: '逻辑模型选择',
        enabled: true,
        description: '',
        position: { x: 100, y: 0 },
        source: 'variable',
        variablePath: 'request.body.model',
        modelIds: [],
        fallbackModelIds: fallbackModelId ? [fallbackModelId] : [],
      },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 200, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ],
    edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'output')],
  }
}


/* ------------------------------------------------------------------------- *
 * 脚本节点
 * ------------------------------------------------------------------------- */

/** 脚本节点的可覆盖字段。 */
type ScriptNodeOverrides = Partial<Extract<WorkflowNodeModel, { kind: 'script' }>>

/** 最小脚本图：输入 → JS 脚本 → 输出。 */
function createScriptGraph(overrides?: ScriptNodeOverrides): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      {
        id: 'script',
        kind: 'script',
        name: 'JS 脚本',
        enabled: true,
        description: '',
        position: { x: 100, y: 0 },
        code: "return get('logicalModels[*].id')",
        resultPath: 'route.scriptResult',
        timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
        ...overrides,
      },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 200, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ],
    edges: [edge('input', 'out', 'script'), edge('script', 'out', 'output')],
  }
}

const scriptPayload = {
  request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
  logicalModels: [{ id: 'model-vip', name: 'VIP', enabled: true }],
  metadata: {},
}

describe('router engine · 脚本节点', () => {
  it('把沙箱返回值写入 resultPath，并把控制台日志带进 trace', async () => {
    const result = await runWorkflowEngine(createScriptGraph(), scriptPayload, {
      capabilities: {
        runScript: async () => ({ success: true, value: ['model-vip'], logs: ['picked 1'], durationMilliseconds: 5 }),
      },
    })

    const payload = result.outputPayload as { route: { scriptResult: string[] } }
    expect(payload.route.scriptResult).toEqual(['model-vip'])

    const scriptTrace = result.trace.find(item => item.nodeId === 'script')
    expect(scriptTrace?.success).toBe(true)
    expect(scriptTrace?.message).toContain('route.scriptResult')
    expect(scriptTrace?.details).toMatchObject({ resultPath: 'route.scriptResult', logs: ['picked 1'], durationMilliseconds: 5 })

    expect(result.nodeOutputs.script?.map(item => item.name)).toEqual(['脚本结果', '耗时', '控制台'])
    expect(result.stopReason).toBe('output')
  })

  it('脚本拿到的是 payload 深拷贝，脚本侧改动不会污染路由决策数据', async () => {
    const result = await runWorkflowEngine(createScriptGraph(), scriptPayload, {
      capabilities: {
        runScript: async (invocation) => {
          const request = invocation.payload.request as { body: { model: string } }
          request.body.model = 'mutated'
          return { success: true, value: request.body.model, logs: [], durationMilliseconds: 1 }
        },
      },
    })

    const payload = result.outputPayload as { request: { body: { model: string } }; route: { scriptResult: string } }
    expect(payload.route.scriptResult).toBe('mutated')
    expect(payload.request.body.model).toBe('gpt-4o-mini')
  })

  it('没有注入沙箱能力时记为失败，但仍然继续走完整张图', async () => {
    const result = await runWorkflowEngine(createScriptGraph(), scriptPayload)

    const scriptTrace = result.trace.find(item => item.nodeId === 'script')
    expect(scriptTrace?.success).toBe(false)
    expect(scriptTrace?.message).toContain('沙箱运行时')
    expect(result.stopReason).toBe('output')
  })

  it('脚本内容为空时不调用沙箱能力', async () => {
    const calls: ScriptInvocation[] = []
    const result = await runWorkflowEngine(createScriptGraph({ code: '   ' }), scriptPayload, {
      capabilities: {
        runScript: async (invocation) => {
          calls.push(invocation)
          return { success: true, value: null, logs: [], durationMilliseconds: 1 }
        },
      },
    })

    expect(calls).toHaveLength(0)
    expect(result.trace.find(item => item.nodeId === 'script')?.message).toContain('脚本内容为空')
  })

  it('沙箱抛出的异常被转成一句可读的失败信息', async () => {
    const result = await runWorkflowEngine(createScriptGraph(), scriptPayload, {
      capabilities: {
        runScript: async () => {
          throw new Error('脚本执行超时（> 2000 ms），已中断')
        },
      },
    })

    const scriptTrace = result.trace.find(item => item.nodeId === 'script')
    expect(scriptTrace?.success).toBe(false)
    expect(scriptTrace?.message).toContain('脚本执行超时')
    expect(scriptTrace?.details).toMatchObject({ error: '脚本执行超时（> 2000 ms），已中断' })
  })

  it('沙箱返回失败时把错误写进 trace，不写入结果路径', async () => {
    const result = await runWorkflowEngine(createScriptGraph(), scriptPayload, {
      capabilities: {
        runScript: async () => ({ success: false, logs: [], error: 'ReferenceError: foo is not defined', durationMilliseconds: 2 }),
      },
    })

    const scriptTrace = result.trace.find(item => item.nodeId === 'script')
    expect(scriptTrace?.success).toBe(false)
    expect(scriptTrace?.message).toContain('ReferenceError')
    expect((result.outputPayload as { route: { scriptResult?: unknown } }).route.scriptResult).toBeUndefined()
  })
})

/* ------------------------------------------------------------------------- *
 * LLM 节点
 * ------------------------------------------------------------------------- */

/** LLM 节点的可覆盖字段。 */
type PromptNodeOverrides = Partial<Extract<WorkflowNodeModel, { kind: 'prompt' }>>

/** 提示词图：输入 → 协议发现 → LLM 节点 → 输出。 */
function createPromptGraph(overrides?: PromptNodeOverrides): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'protocol', kind: 'protocol-discovery', name: '协议发现', enabled: true, description: '', position: { x: 100, y: 0 } },
      {
        id: 'prompt',
        kind: 'prompt',
        name: 'LLM 节点',
        enabled: true,
        description: '',
        position: { x: 200, y: 0 },
        logicalModelId: 'model-vip',
        systemPrompt: '租户 ${request.body.tenant} 的路由助手',
        promptTemplate: '请在 ${logicalModels[*].id} 里挑一个，请求模型是 ${request.body.model}，未知字段是 ${route.neverSet}。',
        resultPath: 'route.promptResult',
        temperature: 0.2,
        maxTokens: 256,
        timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
        ...overrides,
      },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ],
    edges: [edge('input', 'out', 'protocol'), edge('protocol', 'openai-completions', 'prompt'), edge('prompt', 'out', 'output')],
  }
}

const promptPayload = {
  request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini', tenant: 'vip-1' } },
  logicalModels: [{ id: 'model-vip', name: 'VIP', enabled: true }, { id: 'model-default', name: '默认', enabled: true }],
  metadata: {},
}

describe('router engine · LLM 节点', () => {
  it('提示词先按当前运行数据插值，再交给逻辑模型执行', async () => {
    const invocations: PromptInvocation[] = []
    const result = await runWorkflowEngine(createPromptGraph(), promptPayload, {
      capabilities: {
        runPrompt: async (invocation) => {
          invocations.push(invocation)
          return { success: true, text: 'model-vip', target: 'openai/gpt-4o-mini', durationMilliseconds: 42 }
        },
      },
    })

    expect(invocations).toHaveLength(1)
    const invocation = invocations[0]
    expect(invocation.nodeId).toBe('prompt')
    expect(invocation.logicalModelId).toBe('model-vip')
    expect(invocation.systemPrompt).toBe('租户 vip-1 的路由助手')
    expect(invocation.prompt).toContain('gpt-4o-mini')
    expect(invocation.prompt).toContain('model-vip')
    // 取不到的变量渲染成空串，不会把 `${...}` 原样发给上游。
    expect(invocation.prompt).not.toContain('${')
    expect(invocation.temperature).toBe(0.2)
    expect(invocation.maxTokens).toBe(256)
    expect(invocation.timeoutMilliseconds).toBe(PROMPT_TIMEOUT_DEFAULT)
    expect(invocation.protocol).toBe('openai-completions')

    const payload = result.outputPayload as { route: { promptResult: string } }
    expect(payload.route.promptResult).toBe('model-vip')

    const promptTrace = result.trace.find(item => item.nodeId === 'prompt')
    expect(promptTrace?.success).toBe(true)
    expect(promptTrace?.details).toMatchObject({
      logicalModelId: 'model-vip',
      target: 'openai/gpt-4o-mini',
      resultPath: 'route.promptResult',
      durationMilliseconds: 42,
    })
    expect(result.nodeOutputs.prompt?.map(item => item.name)).toEqual(['逻辑模型', '提示词', '回复', '耗时'])
    expect(result.stopReason).toBe('output')
  })

  it('没有选择逻辑模型时不调用执行能力', async () => {
    const invocations: PromptInvocation[] = []
    const result = await runWorkflowEngine(createPromptGraph({ logicalModelId: '  ' }), promptPayload, {
      capabilities: {
        runPrompt: async (invocation) => {
          invocations.push(invocation)
          return { success: true, text: 'unused', durationMilliseconds: 1 }
        },
      },
    })

    expect(invocations).toHaveLength(0)
    expect(result.trace.find(item => item.nodeId === 'prompt')?.message).toContain('尚未选择逻辑模型')
  })

  it('没有注入执行能力时记为失败，但仍然继续走完整张图', async () => {
    const result = await runWorkflowEngine(createPromptGraph(), promptPayload)

    const promptTrace = result.trace.find(item => item.nodeId === 'prompt')
    expect(promptTrace?.success).toBe(false)
    expect(promptTrace?.message).toContain('服务端执行能力')
    expect(result.stopReason).toBe('output')
  })

  it('上游调用失败时把错误写进 trace，不写入结果路径', async () => {
    const result = await runWorkflowEngine(createPromptGraph(), promptPayload, {
      capabilities: {
        runPrompt: async () => ({ success: false, text: '', error: '上游 429：rate limit exceeded', durationMilliseconds: 8 }),
      },
    })

    const promptTrace = result.trace.find(item => item.nodeId === 'prompt')
    expect(promptTrace?.success).toBe(false)
    expect(promptTrace?.message).toContain('上游 429')
    expect((result.outputPayload as { route: { promptResult?: unknown } }).route.promptResult).toBeUndefined()
  })

  it('执行能力抛出的异常被转成一句可读的失败信息', async () => {
    const result = await runWorkflowEngine(createPromptGraph(), promptPayload, {
      capabilities: {
        runPrompt: async () => {
          throw new Error('LLM 调用超时（> 60000 ms），已中断')
        },
      },
    })

    const promptTrace = result.trace.find(item => item.nodeId === 'prompt')
    expect(promptTrace?.success).toBe(false)
    expect(promptTrace?.message).toContain('LLM 调用超时')
  })
})

/* ------------------------------------------------------------------------- *
 * 图 schema：新节点类型
 * ------------------------------------------------------------------------- */

describe('router graph schema · 脚本与 LLM 节点', () => {
  it('脚本节点通过校验，缺失字段按默认值补齐', () => {
    const parsed = WorkflowGraphSchema.safeParse({
      version: 1,
      nodes: [{ id: 'script', kind: 'script', name: 'JS 脚本', enabled: true, description: '', position: { x: 0, y: 0 } }],
      edges: [],
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.nodes[0]).toMatchObject({
      kind: 'script',
      code: '',
      resultPath: 'route.scriptResult',
      timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
    })
  })

  it('LLM 节点通过校验，缺失字段按默认值补齐', () => {
    const parsed = WorkflowGraphSchema.safeParse({
      version: 1,
      nodes: [{ id: 'prompt', kind: 'prompt', name: 'LLM 节点', enabled: true, description: '', position: { x: 0, y: 0 } }],
      edges: [],
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.nodes[0]).toMatchObject({
      kind: 'prompt',
      logicalModelId: '',
      systemPrompt: '',
      resultPath: 'route.promptResult',
      temperature: 0.7,
      maxTokens: 1_024,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    })
  })

  it('超时超过上限的脚本节点校验失败', () => {
    const parsed = WorkflowGraphSchema.safeParse({
      version: 1,
      nodes: [{ id: 'script', kind: 'script', name: 'JS 脚本', enabled: true, description: '', position: { x: 0, y: 0 }, code: 'return 1', resultPath: 'route.r', timeoutMilliseconds: 999_999 }],
      edges: [],
    })

    expect(parsed.success).toBe(false)
  })

  it('温度超出 0..2 的 LLM 节点校验失败', () => {
    const parsed = WorkflowGraphSchema.safeParse({
      version: 1,
      nodes: [{ id: 'prompt', kind: 'prompt', name: 'LLM 节点', enabled: true, description: '', position: { x: 0, y: 0 }, temperature: 3 }],
      edges: [],
    })

    expect(parsed.success).toBe(false)
  })
})
