import { describe, expect, it } from 'vitest'
import { createRouteContextInput, getByPath, readLandingModelIds, readRouteDecision, runWorkflow as runWorkflowEngine, type WorkflowRunOptions } from './engine'
import { ALL_CONDITION_OPERATORS, PROMPT_TIMEOUT_DEFAULT, PROMPT_TIMEOUT_LIMIT, SCRIPT_TIMEOUT_DEFAULT, SCRIPT_TIMEOUT_LIMIT } from './types'
import type {
  ConditionCase,
  ConditionRule,
  ControlInputItem,
  PromptInvocation,
  PromptInvocationResult,
  RouteContextInput,
  RuntimeLogicalModel,
  ScriptInvocation,
  ScriptInvocationResult,
  WorkflowGraph,
  WorkflowNodeModel,
  WorkflowRequestPayload,
  WorkflowRunResult,
} from './types'

/**
 * 内置节点逐个验收。
 *
 * `engine.test.ts` 覆盖的是「一张完整的图跑出什么结果」，这里补的是**每个节点自己**的语义：
 * 禁用的节点怎么走、缺配置时失败还是继续、trace 记了什么、边界值是否被夹住。
 * 断言全部落在 trace / nodeOutputs / payload 三个可观察面上，不碰内部实现。
 */

type NodeOf<K extends WorkflowNodeModel['kind']> = Extract<WorkflowNodeModel, { kind: K }>

const position = { x: 0, y: 0 }

const edge = (sourceNodeId: string, sourcePort: string, targetNodeId: string) => ({
  id: `${sourceNodeId}:${sourcePort}->${targetNodeId}`,
  sourceNodeId,
  sourcePort,
  targetNodeId,
})

function runWorkflow(graph: WorkflowGraph, inputPayload: unknown, options?: WorkflowRunOptions) {
  return runWorkflowEngine(graph, inputPayload, options)
}

type InputRequestExtra = Omit<Partial<RouteContextInput>, 'request'> & { request?: WorkflowRequestPayload }

/** 请求入参的简写：默认是一条 POST /v1/chat/completions，`extra.request` 里的字段覆盖默认值。 */
function inputRequest(body: Record<string, unknown> = {}, extra: InputRequestExtra = {}): RouteContextInput {
  return { ...extra, request: { path: '/v1/chat/completions', method: 'POST', body, ...extra.request } }
}

function inputNode(overrides: Partial<NodeOf<'input'>> = {}): NodeOf<'input'> {
  return { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position, ...overrides }
}

function outputNode(overrides: Partial<NodeOf<'output'>> = {}): NodeOf<'output'> {
  return { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position, includeTrace: true, summaryLevel: 'detailed', ...overrides }
}

function controlInputNode(controls: ControlInputItem[], overrides: Partial<NodeOf<'control-input'>> = {}): NodeOf<'control-input'> {
  return { id: 'control', kind: 'control-input', name: '控制输入', enabled: true, description: '', position, controls, ...overrides }
}

function protocolNode(overrides: Partial<NodeOf<'protocol-discovery'>> = {}): NodeOf<'protocol-discovery'> {
  return { id: 'protocol', kind: 'protocol-discovery', name: '协议发现', enabled: true, description: '', position, ...overrides }
}

function conditionNode(cases: ConditionCase[], overrides: Partial<NodeOf<'condition'>> = {}): NodeOf<'condition'> {
  return { id: 'condition', kind: 'condition', name: '条件', enabled: true, description: '', position, cases, ...overrides }
}

function modelSelectNode(overrides: Partial<NodeOf<'model-select'>> = {}): NodeOf<'model-select'> {
  return { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position, source: 'fixed', variablePath: '', modelIds: [], fallbackModelIds: [], ...overrides }
}

function iterationNode(overrides: Partial<NodeOf<'iteration'>> = {}): NodeOf<'iteration'> {
  return {
    id: 'loop', kind: 'iteration', name: '遍历迭代', enabled: true, description: '', position,
    sourcePath: 'request.body.items', collectPath: 'route.iteration.item', collectMode: 'first', resultPath: 'route.iterationResult', maxIterations: 10,
    ...overrides,
  }
}

function scriptNode(overrides: Partial<NodeOf<'script'>> = {}): NodeOf<'script'> {
  return { id: 'script', kind: 'script', name: 'JS 脚本', enabled: true, description: '', position, code: 'return "ok"', resultPath: 'route.scriptResult', timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT, ...overrides }
}

function promptNode(overrides: Partial<NodeOf<'prompt'>> = {}): NodeOf<'prompt'> {
  return {
    id: 'prompt', kind: 'prompt', name: 'LLM', enabled: true, description: '', position,
    logicalModelId: 'model-fast', systemPrompt: '', promptTemplate: '', resultPath: 'route.reply', temperature: 0.7, maxTokens: 1_024, timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    ...overrides,
  }
}

function traceOf(result: WorkflowRunResult, nodeId: string) {
  return result.trace.find(item => item.nodeId === nodeId)
}

function traceDetails(result: WorkflowRunResult, nodeId: string): Record<string, unknown> {
  return (traceOf(result, nodeId)?.details ?? {}) as Record<string, unknown>
}

function outputNames(result: WorkflowRunResult, nodeId: string): string[] {
  return (result.nodeOutputs[nodeId] ?? []).map(item => item.name)
}

function outputValue(result: WorkflowRunResult, nodeId: string, name: string): unknown {
  return (result.nodeOutputs[nodeId] ?? []).find(item => item.name === name)?.value
}

function outputNote(result: WorkflowRunResult, nodeId: string, name: string): string | undefined {
  return (result.nodeOutputs[nodeId] ?? []).find(item => item.name === name)?.note
}

/** 引擎写回的 `route` 命名空间；测试只把它当普通对象读。 */
function routeOf(result: WorkflowRunResult): Record<string, unknown> {
  return (result.outputPayload as { route: Record<string, unknown> }).route
}

function scriptCapability(overrides: Partial<ScriptInvocationResult> = {}) {
  const calls: ScriptInvocation[] = []
  const run = async (invocation: ScriptInvocation): Promise<ScriptInvocationResult> => {
    calls.push(invocation)
    return { success: true, value: 'script-ok', logs: [], durationMilliseconds: 7, ...overrides }
  }
  return { calls, run }
}

function promptCapability(overrides: Partial<PromptInvocationResult> = {}) {
  const calls: PromptInvocation[] = []
  const run = async (invocation: PromptInvocation): Promise<PromptInvocationResult> => {
    calls.push(invocation)
    return { success: true, text: 'model-reply', durationMilliseconds: 5, ...overrides }
  }
  return { calls, run }
}

describe('内置节点 · 输入节点', () => {
  it('原样上报可见逻辑模型（含停用项），顺序不重排', async () => {
    const graph: WorkflowGraph = { version: 1, nodes: [inputNode(), outputNode()], edges: [edge('input', 'out', 'output')] }

    const result = await runWorkflow(graph, {
      request: { path: '/v1/chat/completions' },
      logicalModels: [
        { modelId: 'model-z', enabled: true },
        { modelId: 'model-a', enabled: false },
      ],
    })

    expect(result.nodeOutputs.input).toEqual([{ name: '逻辑模型', value: ['model-z', 'model-a'] }])
    expect(traceOf(result, 'input')?.message).toBe('输入进入路由流程')
  })

  it('逻辑模型列表缺失时上报空列表，而不是报错', async () => {
    const graph: WorkflowGraph = { version: 1, nodes: [inputNode(), outputNode()], edges: [edge('input', 'out', 'output')] }

    const result = await runWorkflow(graph, { request: { path: '/v1/chat/completions' } })

    expect(outputValue(result, 'input', '逻辑模型')).toEqual([])
    expect(result.stopReason).toBe('output')
  })

  it('画布上禁用输入节点也照常进入路由流程', async () => {
    const graph: WorkflowGraph = { version: 1, nodes: [inputNode({ enabled: false }), outputNode()], edges: [edge('input', 'out', 'output')] }

    const result = await runWorkflow(graph, { logicalModels: [{ modelId: 'default', enabled: true }] })

    expect(traceOf(result, 'input')?.message).toBe('输入进入路由流程')
    expect(outputValue(result, 'input', '逻辑模型')).toEqual(['default'])
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · 控制输入节点', () => {
  const enabledFeature: ControlInputItem = { id: 'c-feature', key: 'featureEnabled', label: '功能开关', kind: 'switch', enabled: true, defaultValue: true }
  const disabledMode: ControlInputItem = { id: 'c-mode', key: 'routeMode', label: '路由模式', kind: 'select', enabled: false, defaultValue: 'balanced', options: [{ label: '均衡', value: 'balanced' }] }

  it('停用的控制项既不写入 route.controls，也不产生输出与 trace 明细', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [inputNode(), controlInputNode([enabledFeature, disabledMode]), outputNode()],
      edges: [edge('input', 'out', 'control'), edge('control', 'out', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest())

    expect(routeOf(result).controls).toEqual({ featureEnabled: true })
    expect(outputNames(result, 'control')).toEqual(['功能开关'])
    expect(traceDetails(result, 'control').controls).toEqual([{ key: 'featureEnabled', kind: 'switch', value: true }])
  })

  it('每条启用控制项各占一条输出，note 是控制项 key', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [inputNode(), controlInputNode([enabledFeature, { ...disabledMode, enabled: true }]), outputNode()],
      edges: [edge('input', 'out', 'control'), edge('control', 'out', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest())

    expect(outputNames(result, 'control')).toEqual(['功能开关', '路由模式'])
    expect(outputValue(result, 'control', '路由模式')).toBe('balanced')
    expect(outputNote(result, 'control', '路由模式')).toBe('routeMode')
    expect(routeOf(result).controls).toEqual({ featureEnabled: true, routeMode: 'balanced' })
  })

  it('多个控制输入节点按执行顺序合并进同一份 route.controls，同 key 后者覆盖', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        inputNode(),
        controlInputNode([{ id: 'a', key: 'routeMode', label: '路由器一', kind: 'select', enabled: true, defaultValue: 'balanced' }]),
        controlInputNode([{ id: 'b', key: 'routeMode', label: '路由器二', kind: 'select', enabled: true, defaultValue: 'quality' }, { id: 'c', key: 'extra', label: '附加', kind: 'switch', enabled: true, defaultValue: false }], { id: 'control-2' }),
        outputNode(),
      ],
      edges: [edge('input', 'out', 'control'), edge('control', 'out', 'control-2'), edge('control-2', 'out', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest())

    expect(routeOf(result).controls).toEqual({ routeMode: 'quality', extra: false })
    expect(outputNames(result, 'control')).toEqual(['路由器一'])
    expect(outputNames(result, 'control-2')).toEqual(['路由器二', '附加'])
  })

  it('控制输入节点被禁用时整节点跳过，route.controls 保持为空对象', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [inputNode(), controlInputNode([enabledFeature], { enabled: false }), outputNode()],
      edges: [edge('input', 'out', 'control'), edge('control', 'out', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest())

    expect(traceOf(result, 'control')?.message).toBe('节点禁用，跳过')
    expect(routeOf(result).controls).toEqual({})
    expect(result.nodeOutputs.control).toBeUndefined()
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · 协议发现节点', () => {
  function protocolGraph(overrides: Partial<NodeOf<'protocol-discovery'>> = {}): WorkflowGraph {
    return {
      version: 1,
      nodes: [inputNode(), protocolNode(overrides), outputNode()],
      edges: [
        edge('input', 'out', 'protocol'),
        edge('protocol', 'openai-completions', 'output'),
        edge('protocol', 'openai-responses', 'output'),
        edge('protocol', 'anthropic-messages', 'output'),
        edge('protocol', 'unknown', 'output'),
      ],
    }
  }

  it('调用方已确定协议时不再按路径形状猜', async () => {
    const result = await runWorkflow(protocolGraph(), {
      protocol: 'anthropic-messages',
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
    })

    expect(result.protocol).toBe('anthropic-messages')
    expect(outputValue(result, 'protocol', '协议')).toBe('anthropic-messages')
    expect(traceOf(result, 'protocol')?.success).toBe(true)
    expect(traceOf(result, 'protocol')?.message).toContain('调用方已确定协议')
    expect(routeOf(result).protocol).toBe('anthropic-messages')
  })

  const shapeCases: Array<[string, WorkflowRequestPayload, string]> = [
    ['x-provider 头声明 anthropic', { path: '/v1/whatever', headers: { 'x-provider': 'anthropic' }, body: {} }, 'anthropic-messages'],
    ['路径形状是 responses', { path: '/v1/responses', headers: {}, body: {} }, 'openai-responses'],
    ['模型名里带 claude', { path: '/v1/whatever', headers: {}, body: { model: 'claude-3-5-sonnet' } }, 'anthropic-messages'],
    ['认不出任何信号', { path: '/v1/embeddings', headers: {}, body: {} }, 'unknown'],
  ]

  it.each(shapeCases)('没有调用方结论时按形状推演：%s', async (_label, request, expected) => {
    const result = await runWorkflow(protocolGraph(), { request })

    expect(result.protocol).toBe(expected)
    expect(outputValue(result, 'protocol', '协议')).toBe(expected)
    expect(routeOf(result).protocol).toBe(expected)
  })

  it('认不出协议时 trace 记为失败，但仍按 unknown 端口继续', async () => {
    const result = await runWorkflow(protocolGraph(), inputRequest({}, { request: { path: '/v1/embeddings' } }))

    expect(traceOf(result, 'protocol')?.success).toBe(false)
    expect(traceOf(result, 'protocol')?.message).toContain('自动识别未命中')
    expect(result.stopReason).toBe('output')
  })

  const transportCases: Array<[string, WorkflowRequestPayload, string]> = [
    ['upgrade: websocket 头', { headers: { upgrade: 'websocket' } }, 'websocket'],
    ['accept 头声明 SSE', { headers: { accept: 'text/event-stream' } }, 'http-stream'],
    ['content-type 声明 SSE', { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }, 'http-stream'],
    ['请求体 stream = true', { body: { stream: true } }, 'http-stream'],
    ['没有任何信号', {}, 'http'],
  ]

  it.each(transportCases)('传输形态按请求头与请求体推演：%s', async (_label, request, expected) => {
    const result = await runWorkflow(protocolGraph(), inputRequest({}, { request: { path: '/v1/chat/completions', ...request } }))

    expect(outputValue(result, 'protocol', '传输形态')).toBe(expected)
    expect(routeOf(result).transport).toBe(expected)
  })

  it('调用方给出传输形态时优先采信，不被请求头推翻', async () => {
    const result = await runWorkflow(protocolGraph(), inputRequest({}, { transport: 'websocket', request: { path: '/v1/chat/completions', headers: { accept: 'text/event-stream' } } }))

    expect(outputValue(result, 'protocol', '传输形态')).toBe('websocket')
    expect(routeOf(result).transport).toBe('websocket')
  })

  it('请求模型按命中协议声明表读取，认不出协议时如实为空串', async () => {
    const hit = await runWorkflow(protocolGraph(), inputRequest({ model: 'gpt-4o-mini' }, { request: { path: '/v1/responses' } }))
    expect(outputValue(hit, 'protocol', '请求模型')).toBe('gpt-4o-mini')

    const miss = await runWorkflow(protocolGraph(), inputRequest({ model: 'gpt-4o-mini' }, { request: { path: '/v1/embeddings' } }))
    expect(outputValue(miss, 'protocol', '请求模型')).toBe('')
  })

  it('禁用协议发现节点时改走 unknown 端口', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [inputNode(), protocolNode({ enabled: false }), outputNode()],
      edges: [edge('input', 'out', 'protocol'), edge('protocol', 'openai-completions', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest({ model: 'gpt-4o-mini' }, { request: { path: '/v1/chat/completions' } }))

    expect(traceOf(result, 'protocol')?.message).toBe('节点禁用，跳过')
    expect(result.protocol).toBe('unknown')
    // 没有 unknown 端口，链到此为止，但运行没有被中断。
    expect(result.stopReason).toBe('missing-next')
  })
})

describe('内置节点 · 条件节点（操作符矩阵）', () => {
  function conditionProbeGraph(cases: ConditionCase[], overrides: Partial<NodeOf<'condition'>> = {}): WorkflowGraph {
    return {
      version: 1,
      nodes: [inputNode(), conditionNode(cases, overrides), modelSelectNode({ id: 'hit', modelIds: ['hit-model'] }), outputNode()],
      edges: [
        edge('input', 'out', 'condition'),
        edge('condition', 'case-1', 'hit'),
        edge('condition', 'out', 'hit'),
        edge('hit', 'out', 'output'),
      ],
    }
  }

  function conditionRule(patch: Partial<ConditionRule> & Pick<ConditionRule, 'operator'>): ConditionRule {
    return { fieldPath: 'request.body.value', valueType: 'string', ...patch }
  }

  async function conditionHit(probe: ConditionRule, input: RouteContextInput): Promise<boolean> {
    const result = await runWorkflow(conditionProbeGraph([{ id: 'case-1', name: '命中', logicalOperator: 'and', conditions: [probe] }]), input)
    return Boolean(traceOf(result, 'condition')?.success)
  }

  interface OperatorCase {
    name: string
    rule: ConditionRule
    input: RouteContextInput
    expected: boolean
  }

  const operatorCases: OperatorCase[] = [
    { name: 'equals：字符串相等', rule: conditionRule({ operator: 'equals', value: 'vip' }), input: inputRequest({ value: 'vip' }), expected: true },
    { name: 'equals：字符串不等', rule: conditionRule({ operator: 'equals', value: 'vip' }), input: inputRequest({ value: 'free' }), expected: false },
    { name: 'equals：数字与字符串等价比较', rule: conditionRule({ operator: 'equals', value: '5', valueType: 'number' }), input: inputRequest({ value: 5 }), expected: true },
    { name: 'equals：对象按结构化序列化比较', rule: conditionRule({ operator: 'equals', value: '{"a":1}', valueType: 'object' }), input: inputRequest({ value: { a: 1 } }), expected: true },
    { name: 'notEquals：不等成立', rule: conditionRule({ operator: 'notEquals', value: 'vip' }), input: inputRequest({ value: 'free' }), expected: true },
    { name: 'notEquals：相等不成立', rule: conditionRule({ operator: 'notEquals', value: 'vip' }), input: inputRequest({ value: 'vip' }), expected: false },
    { name: 'contains：字符串子串命中', rule: conditionRule({ operator: 'contains', fieldPath: 'request.body.model', value: 'claude' }), input: inputRequest({ model: 'claude-3-5-sonnet' }), expected: true },
    { name: 'contains：对象按键名命中', rule: conditionRule({ operator: 'contains', fieldPath: 'request.body', value: 'tenant', valueType: 'object' }), input: inputRequest({ tenant: 'vip' }), expected: true },
    { name: 'contains：数组按元素字符串命中', rule: conditionRule({ operator: 'contains', fieldPath: 'request.body.tags', value: 'fast', valueType: 'array' }), input: inputRequest({ tags: ['fast', 'cheap'] }), expected: true },
    { name: 'notContains：子串未出现', rule: conditionRule({ operator: 'notContains', fieldPath: 'request.body.model', value: 'claude' }), input: inputRequest({ model: 'gpt-4o' }), expected: true },
    { name: 'notContains：子串出现则不成立', rule: conditionRule({ operator: 'notContains', fieldPath: 'request.body.model', value: 'gpt' }), input: inputRequest({ model: 'gpt-4o' }), expected: false },
    { name: 'startsWith：前缀命中', rule: conditionRule({ operator: 'startsWith', value: 'vip-' }), input: inputRequest({ value: 'vip-cn' }), expected: true },
    { name: 'startsWith：前缀不符', rule: conditionRule({ operator: 'startsWith', value: 'svip-' }), input: inputRequest({ value: 'vip-cn' }), expected: false },
    { name: 'endsWith：后缀命中', rule: conditionRule({ operator: 'endsWith', value: '-cn' }), input: inputRequest({ value: 'vip-cn' }), expected: true },
    { name: 'endsWith：后缀不符', rule: conditionRule({ operator: 'endsWith', value: '-us' }), input: inputRequest({ value: 'vip-cn' }), expected: false },
    { name: 'in：字面量按逗号拆分成集合', rule: conditionRule({ operator: 'in', value: ' fast , safe ' }), input: inputRequest({ value: 'safe' }), expected: true },
    { name: 'in：不在集合里则不成立', rule: conditionRule({ operator: 'in', value: 'fast,safe' }), input: inputRequest({ value: 'slow' }), expected: false },
    { name: 'in：枚举候选集优先于字面量', rule: conditionRule({ operator: 'in', valueType: 'enum', value: 'ignored', enumOptions: ['fast', 'safe'] }), input: inputRequest({ value: 'fast' }), expected: true },
    { name: 'in：比较值来自另一个字段（通配投影）', rule: conditionRule({ operator: 'in', valueSource: 'field', valueFieldPath: 'logicalModels[*].modelId', value: 'ignored' }), input: inputRequest({ value: 'model-b' }, { logicalModels: [{ modelId: 'model-a', enabled: true }, { modelId: 'model-b', enabled: true }] }), expected: true },
    { name: 'in：比较值为空数组时无人命中', rule: conditionRule({ operator: 'in', valueSource: 'field', valueFieldPath: 'logicalModels[*].modelId', value: 'ignored' }), input: inputRequest({ value: 'model-b' }, { logicalModels: [] }), expected: false },
    { name: 'notIn：不在集合里成立', rule: conditionRule({ operator: 'notIn', value: 'fast, safe' }), input: inputRequest({ value: 'slow' }), expected: true },
    { name: 'notIn：在集合里不成立', rule: conditionRule({ operator: 'notIn', value: 'fast, safe' }), input: inputRequest({ value: 'fast' }), expected: false },
    { name: 'regex：匹配请求路径', rule: conditionRule({ operator: 'regex', fieldPath: 'request.path', value: '^/v1/(chat/)?completions$' }), input: inputRequest(), expected: true },
    { name: 'regex：模式非法时判定为 false 而不是抛错', rule: conditionRule({ operator: 'regex', value: '[' }), input: inputRequest({ value: 'anything' }), expected: false },
    { name: 'gt：大于成立', rule: conditionRule({ operator: 'gt', valueType: 'number', value: '3' }), input: inputRequest({ value: 5 }), expected: true },
    { name: 'gt：边界相等不成立（严格大于）', rule: conditionRule({ operator: 'gt', valueType: 'number', value: '5' }), input: inputRequest({ value: 5 }), expected: false },
    { name: 'gt：实际值不是数字时不成立', rule: conditionRule({ operator: 'gt', valueType: 'number', value: '3' }), input: inputRequest({ value: 'abc' }), expected: false },
    { name: 'gte：边界相等成立', rule: conditionRule({ operator: 'gte', valueType: 'number', value: '5' }), input: inputRequest({ value: 5 }), expected: true },
    { name: 'lt：小于成立', rule: conditionRule({ operator: 'lt', valueType: 'number', value: '5' }), input: inputRequest({ value: 3 }), expected: true },
    { name: 'lt：边界相等不成立', rule: conditionRule({ operator: 'lt', valueType: 'number', value: '5' }), input: inputRequest({ value: 5 }), expected: false },
    { name: 'lte：边界相等成立', rule: conditionRule({ operator: 'lte', valueType: 'number', value: '5' }), input: inputRequest({ value: 5 }), expected: true },
    { name: 'lte：超出上界不成立', rule: conditionRule({ operator: 'lte', valueType: 'number', value: '5' }), input: inputRequest({ value: 6 }), expected: false },
    { name: 'between：闭区间内成立', rule: conditionRule({ operator: 'between', valueType: 'number', value: '1', secondaryValue: '10' }), input: inputRequest({ value: 5 }), expected: true },
    { name: 'between：下界边界也算命中（闭区间）', rule: conditionRule({ operator: 'between', valueType: 'number', value: '1', secondaryValue: '10' }), input: inputRequest({ value: 1 }), expected: true },
    { name: 'between：上界边界也算命中（闭区间）', rule: conditionRule({ operator: 'between', valueType: 'number', value: '1', secondaryValue: '10' }), input: inputRequest({ value: 10 }), expected: true },
    { name: 'between：区间外不成立', rule: conditionRule({ operator: 'between', valueType: 'number', value: '1', secondaryValue: '10' }), input: inputRequest({ value: 11 }), expected: false },
    { name: 'between：上界不是数字时不成立', rule: conditionRule({ operator: 'between', valueType: 'number', value: '1', secondaryValue: 'x' }), input: inputRequest({ value: 5 }), expected: false },
    { name: 'isTrue：严格等于 true', rule: conditionRule({ operator: 'isTrue', valueType: 'boolean' }), input: inputRequest({ value: true }), expected: true },
    { name: 'isTrue：数字 1 不算 true', rule: conditionRule({ operator: 'isTrue', valueType: 'boolean' }), input: inputRequest({ value: 1 }), expected: false },
    { name: 'isTrue：字符串 "true" 不算 true', rule: conditionRule({ operator: 'isTrue', valueType: 'boolean' }), input: inputRequest({ value: 'true' }), expected: false },
    { name: 'isFalse：严格等于 false', rule: conditionRule({ operator: 'isFalse', valueType: 'boolean' }), input: inputRequest({ value: false }), expected: true },
    { name: 'isFalse：数字 0 不算 false', rule: conditionRule({ operator: 'isFalse', valueType: 'boolean' }), input: inputRequest({ value: 0 }), expected: false },
    { name: 'empty：空字符串成立', rule: conditionRule({ operator: 'empty' }), input: inputRequest({ value: '' }), expected: true },
    { name: 'empty：全空白字符串成立', rule: conditionRule({ operator: 'empty' }), input: inputRequest({ value: '   ' }), expected: true },
    { name: 'empty：空数组成立', rule: conditionRule({ operator: 'empty', valueType: 'array' }), input: inputRequest({ value: [] }), expected: true },
    { name: 'empty：空对象成立', rule: conditionRule({ operator: 'empty', valueType: 'object' }), input: inputRequest({ value: {} }), expected: true },
    { name: 'empty：数字 0 不算空', rule: conditionRule({ operator: 'empty', valueType: 'number' }), input: inputRequest({ value: 0 }), expected: false },
    { name: 'notEmpty：空数组不成立', rule: conditionRule({ operator: 'notEmpty', valueType: 'array' }), input: inputRequest({ value: [] }), expected: false },
    { name: 'notEmpty：有内容的字符串成立', rule: conditionRule({ operator: 'notEmpty' }), input: inputRequest({ value: 'x' }), expected: true },
    { name: 'exists：空数组也算「存在」', rule: conditionRule({ operator: 'exists', valueType: 'array' }), input: inputRequest({ value: [] }), expected: true },
    { name: 'exists：false 也算「存在」', rule: conditionRule({ operator: 'exists', valueType: 'boolean' }), input: inputRequest({ value: false }), expected: true },
    { name: 'exists：路径不存在时不成立', rule: conditionRule({ operator: 'exists' }), input: inputRequest({}), expected: false },
    { name: 'exists：null 视为不存在', rule: conditionRule({ operator: 'exists' }), input: inputRequest({ value: null }), expected: false },
  ]

  it.each(operatorCases)('$name', async ({ rule, input, expected }) => {
    expect(await conditionHit(rule, input)).toBe(expected)
  })

  it('操作符矩阵覆盖全部内置操作符（新增操作符必须补一条探针）', () => {
    const covered = new Set(operatorCases.map(item => item.rule.operator))
    expect([...covered].sort()).toEqual([...ALL_CONDITION_OPERATORS].sort())
  })

  it('同一条分支内多条规则按 logicalOperator 组合', async () => {
    const rules: ConditionRule[] = [
      conditionRule({ operator: 'startsWith', fieldPath: 'request.body.model', value: 'gpt-' }),
      conditionRule({ operator: 'endsWith', fieldPath: 'request.body.model', value: '-mini' }),
    ]

    const andResult = await runWorkflow(conditionProbeGraph([{ id: 'case-1', name: '命中', logicalOperator: 'and', conditions: rules }]), inputRequest({ model: 'gpt-4o' }))
    expect(traceOf(andResult, 'condition')?.success).toBe(false)

    const orResult = await runWorkflow(conditionProbeGraph([{ id: 'case-1', name: '命中', logicalOperator: 'or', conditions: rules }]), inputRequest({ model: 'gpt-4o' }))
    expect(traceOf(orResult, 'condition')?.success).toBe(true)
  })

  it('trace 记录每条分支的命中情况与最终端口', async () => {
    const cases: ConditionCase[] = [
      { id: 'case-vip', name: 'VIP 租户', logicalOperator: 'and', conditions: [conditionRule({ operator: 'startsWith', fieldPath: 'request.body.tenant', value: 'vip-' })] },
      { id: 'case-free', name: '免费租户', logicalOperator: 'and', conditions: [conditionRule({ operator: 'equals', fieldPath: 'request.body.tenant', value: 'free' })] },
    ]

    const result = await runWorkflow(conditionProbeGraph(cases), inputRequest({ tenant: 'vip-cn' }))

    expect(outputValue(result, 'condition', 'VIP 租户')).toBe('命中')
    expect(outputValue(result, 'condition', '免费租户')).toBe('未命中')
    expect(traceDetails(result, 'condition').sourcePort).toBe('case-vip')
    expect(traceDetails(result, 'condition').matchedCaseId).toBe('case-vip')
    expect(traceOf(result, 'condition')?.message).toContain('VIP 租户')

    const missed = await runWorkflow(conditionProbeGraph(cases), inputRequest({ tenant: 'enterprise' }))
    expect(traceDetails(missed, 'condition').sourcePort).toBe('else')
    expect(traceDetails(missed, 'condition').matchedCaseId).toBeNull()
    expect(traceOf(missed, 'condition')?.message).toBe('未命中任何分支，走 ELSE')
  })

  it('一个分支都未命中且没有 else 连线时链路自然终止', async () => {
    const result = await runWorkflow(
      { version: 1, nodes: [inputNode(), conditionNode([{ id: 'case-1', name: '命中', logicalOperator: 'and', conditions: [conditionRule({ operator: 'equals', value: 'never' })] }])], edges: [edge('input', 'out', 'condition')] },
      inputRequest({ value: 'other' }),
    )

    expect(result.stopReason).toBe('missing-next')
  })

  it('禁用条件节点时改走 out 端口，不评估任何分支', async () => {
    const result = await runWorkflow(
      conditionProbeGraph([{ id: 'case-1', name: '命中', logicalOperator: 'and', conditions: [conditionRule({ operator: 'equals', value: 'nope' })] }], { enabled: false }),
      inputRequest({ value: 'nope' }),
    )

    expect(traceOf(result, 'condition')?.message).toBe('节点禁用，跳过')
    expect(outputValue(result, 'hit', '落点逻辑模型')).toEqual(['hit-model'])
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · 逻辑模型选择节点', () => {
  function modelGraph(node: NodeOf<'model-select'>): WorkflowGraph {
    return { version: 1, nodes: [inputNode(), node, outputNode()], edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'output')] }
  }

  it('固定来源未选任何逻辑模型时落点为空并记为失败', async () => {
    const result = await runWorkflow(modelGraph(modelSelectNode({ source: 'fixed', modelIds: [] })), inputRequest())

    expect(routeOf(result).modelIds).toEqual([])
    expect(routeOf(result).fallback).toBe(false)
    expect(traceOf(result, 'model-select')?.success).toBe(false)
    expect(traceOf(result, 'model-select')?.message).toBe('尚未选择任何逻辑模型')
    expect(outputNames(result, 'model-select')).toEqual(['落点逻辑模型'])
  })

  it('固定来源的 id 去空白、丢空串并去重', async () => {
    const result = await runWorkflow(modelGraph(modelSelectNode({ modelIds: ['  model-a  ', '', '   ', 'model-a', 'model-b'] })), inputRequest())

    expect(routeOf(result).modelIds).toEqual(['model-a', 'model-b'])
    expect(routeOf(result).fallback).toBe(false)
    expect(traceDetails(result, 'model-select').matched).toBe(true)
  })

  it('变量来源未配置路径时如实标注「（未配置）」并直接兜底', async () => {
    const result = await runWorkflow(modelGraph(modelSelectNode({ source: 'variable', variablePath: '', fallbackModelIds: ['model-default'] })), inputRequest())

    expect(outputValue(result, 'model-select', '取值字段')).toBe('（未配置）')
    expect(routeOf(result).modelIds).toEqual(['model-default'])
    expect(routeOf(result).fallback).toBe(true)
    expect(outputNote(result, 'model-select', '落点逻辑模型')).toBe('兜底')
    expect(traceOf(result, 'model-select')?.message).toContain('回落到兜底逻辑模型 model-default')
  })

  it('变量来源取到数组时按字符串归一化（数字也能用）', async () => {
    const result = await runWorkflow(
      modelGraph(modelSelectNode({ source: 'variable', variablePath: 'metadata.ids', fallbackModelIds: ['model-default'] })),
      inputRequest({}, { metadata: { ids: [1, 2, ' 2 '] } }),
    )

    expect(routeOf(result).modelIds).toEqual(['1', '2'])
    expect(routeOf(result).fallback).toBe(false)
    expect(traceDetails(result, 'model-select').variablePath).toBe('metadata.ids')
  })

  it('变量来源取不到值且未配兜底时落点为空', async () => {
    const result = await runWorkflow(modelGraph(modelSelectNode({ source: 'variable', variablePath: 'request.body.model' })), inputRequest({}))

    expect(routeOf(result).modelIds).toEqual([])
    expect(routeOf(result).fallback).toBe(false)
    expect(traceOf(result, 'model-select')?.message).toContain('且未配置兜底逻辑模型')
  })

  it('固定来源不产出「取值字段」输出', async () => {
    const result = await runWorkflow(modelGraph(modelSelectNode({ modelIds: ['model-a'] })), inputRequest())

    expect(outputNames(result, 'model-select')).toEqual(['落点逻辑模型'])
    expect(outputNote(result, 'model-select', '落点逻辑模型')).toBeUndefined()
  })

  it('禁用逻辑模型选择节点时跳过，落点保持为空', async () => {
    const result = await runWorkflow(modelGraph(modelSelectNode({ modelIds: ['model-a'], enabled: false })), inputRequest())

    expect(traceOf(result, 'model-select')?.message).toBe('节点禁用，跳过')
    expect(routeOf(result).modelIds).toEqual([])
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · 遍历迭代节点', () => {
  function iterationGraph(overrides: Partial<NodeOf<'iteration'>> = {}, bodyTarget: 'body' | 'output' = 'body'): WorkflowGraph {
    const bodyEdges = bodyTarget === 'body'
      ? [edge('loop', 'body', 'body-model'), edge('body-model', 'out', 'loop')]
      : [edge('loop', 'body', 'output')]

    return {
      version: 1,
      nodes: [inputNode(), iterationNode(overrides), modelSelectNode({ id: 'body-model', modelIds: ['body-hit'] }), outputNode()],
      edges: [edge('input', 'out', 'loop'), ...bodyEdges, edge('loop', 'out', 'output')],
    }
  }

  const items = (values: unknown[]) => inputRequest({ items: values })

  it('resultPath 留空时只判定命中，不覆盖循环体已经写下的落点', async () => {
    const result = await runWorkflow(iterationGraph({ resultPath: '', collectMode: 'list' }), items(['a', 'b', 'c']))

    expect(routeOf(result).iterationResult).toBeUndefined()
    expect(routeOf(result).modelIds).toEqual(['body-hit'])
    expect(traceDetails(result, 'loop').resultPath).toBe('')
    expect(traceDetails(result, 'loop').hitCount).toBe(3)
    expect(outputValue(result, 'loop', '汇总结果')).toEqual(['a', 'b', 'c'])
  })

  it('first 命中首项即停，last 保留最后一项', async () => {
    const first = await runWorkflow(iterationGraph({ collectMode: 'first' }), items(['a', 'b', 'c']))
    expect(outputValue(first, 'loop', '汇总结果')).toBe('a')
    expect(traceDetails(first, 'loop').executed).toBe(1)
    expect(traceDetails(first, 'loop').stoppedReason).toBe('第 1 轮首次命中，提前结束')

    const last = await runWorkflow(iterationGraph({ collectMode: 'last' }), items(['a', 'b', 'c']))
    expect(outputValue(last, 'loop', '汇总结果')).toBe('c')
    expect(traceDetails(last, 'loop').executed).toBe(3)
    expect(traceDetails(last, 'loop').stoppedReason).toBe('全部遍历完成')
  })

  it('标量来源按「只有一项的集合」处理，键名为空串', async () => {
    const result = await runWorkflow(iterationGraph({ sourcePath: 'request.method', collectMode: 'count' }), inputRequest())

    expect(traceDetails(result, 'loop').itemCount).toBe(1)
    expect(traceDetails(result, 'loop').executed).toBe(1)
    expect(outputNames(result, 'loop')).toContain('第 1 轮')
    expect(outputValue(result, 'loop', '第 1 轮')).toBe('POST')
    expect(routeOf(result).iterationResult).toBe(1)
  })

  it('来源取不到值时一轮都不执行，汇总为空数组', async () => {
    const result = await runWorkflow(iterationGraph({ collectMode: 'first' }), inputRequest({}))

    expect(traceDetails(result, 'loop').itemCount).toBe(0)
    expect(traceDetails(result, 'loop').executed).toBe(0)
    expect(traceDetails(result, 'loop').stoppedReason).toBe('全部遍历完成')
    expect(outputValue(result, 'loop', '遍历轮数')).toBe(0)
    expect(routeOf(result).iterationResult).toEqual([])
  })

  it('轮数上限至少为 1，非整数向下取整', async () => {
    const zero = await runWorkflow(iterationGraph({ maxIterations: 0, collectMode: 'list' }), items(['a', 'b', 'c']))
    expect(traceDetails(zero, 'loop').executed).toBe(1)
    expect(traceDetails(zero, 'loop').stoppedReason).toBe('达到迭代上限 1 轮，剩余 2 项未遍历')

    const fractional = await runWorkflow(iterationGraph({ maxIterations: 2.9, collectMode: 'list' }), items(['a', 'b', 'c']))
    expect(traceDetails(fractional, 'loop').executed).toBe(2)
    expect(traceDetails(fractional, 'loop').stoppedReason).toBe('达到迭代上限 2 轮，剩余 1 项未遍历')
  })

  it('循环体直接连到出口时整轮提前结束，出口只执行一次', async () => {
    const result = await runWorkflow(iterationGraph({}, 'output'), items(['a', 'b', 'c']))

    expect(result.stopReason).toBe('output')
    expect(traceDetails(result, 'loop').executed).toBe(1)
    expect(result.trace.filter(item => item.nodeId === 'output')).toHaveLength(1)
  })

  it('没有连接循环体时记为失败并说明原因', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [inputNode(), iterationNode(), outputNode()],
      edges: [edge('input', 'out', 'loop'), edge('loop', 'out', 'output')],
    }

    const result = await runWorkflow(graph, items(['a', 'b']))

    expect(traceOf(result, 'loop')?.success).toBe(false)
    expect(traceOf(result, 'loop')?.message).toBe('遍历迭代节点没有连接循环体，无法执行')
    expect(traceDetails(result, 'loop').bodyConnected).toBe(false)
    expect(traceDetails(result, 'loop').executed).toBe(0)
  })

  it('禁用遍历迭代节点时跳过，不进入循环体', async () => {
    const result = await runWorkflow(iterationGraph({ enabled: false }), items(['a', 'b']))

    expect(traceOf(result, 'loop')?.message).toBe('节点禁用，跳过')
    expect(result.nodeOutputs['body-model']).toBeUndefined()
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · JS 脚本节点', () => {
  function scriptGraph(overrides: Partial<NodeOf<'script'>> = {}): WorkflowGraph {
    return { version: 1, nodes: [inputNode(), scriptNode(overrides), outputNode()], edges: [edge('input', 'out', 'script'), edge('script', 'out', 'output')] }
  }

  it('超时超过上限时按上限夹取', async () => {
    const capability = scriptCapability()
    const result = await runWorkflow(scriptGraph({ timeoutMilliseconds: SCRIPT_TIMEOUT_LIMIT * 10 }), inputRequest(), { capabilities: { runScript: capability.run } })

    expect(capability.calls.map(call => call.timeoutMilliseconds)).toEqual([SCRIPT_TIMEOUT_LIMIT])
    expect(traceDetails(result, 'script').timeoutMilliseconds).toBe(SCRIPT_TIMEOUT_LIMIT)
  })

  const invalidTimeouts: Array<[string, number]> = [
    ['零', 0],
    ['负数', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ]

  it.each(invalidTimeouts)('超时是%s时也按上限处理，不会变成无上限', async (_label, configured) => {
    const capability = scriptCapability()
    await runWorkflow(scriptGraph({ timeoutMilliseconds: configured }), inputRequest(), { capabilities: { runScript: capability.run } })

    expect(capability.calls[0]?.timeoutMilliseconds).toBe(SCRIPT_TIMEOUT_LIMIT)
  })

  it('脚本拿到的是 payload 深拷贝，改不动引擎正在用的决策数据', async () => {
    const calls: ScriptInvocation[] = []
    const run = async (invocation: ScriptInvocation): Promise<ScriptInvocationResult> => {
      calls.push(invocation)
      const payload = invocation.payload as { route: Record<string, unknown>; metadata: Record<string, unknown> }
      payload.route.traceId = 'changed-by-script'
      payload.metadata.custom = 'changed-by-script'
      return { success: true, value: 'ok', logs: [], durationMilliseconds: 1 }
    }

    const result = await runWorkflow(scriptGraph(), inputRequest({}, { metadata: { traceId: 'trace-keep', custom: 'keep' } }), { capabilities: { runScript: run } })

    expect(calls).toHaveLength(1)
    expect(routeOf(result).traceId).toBe('trace-keep')
    expect((result.outputPayload as { metadata: Record<string, unknown> }).metadata.custom).toBe('keep')
  })

  it('结果路径为空时不写回，按失败记录并说明路径未配置', async () => {
    const capability = scriptCapability()
    const result = await runWorkflow(scriptGraph({ resultPath: '   ' }), inputRequest(), { capabilities: { runScript: capability.run } })

    expect(routeOf(result).scriptResult).toBeUndefined()
    expect(traceOf(result, 'script')?.success).toBe(false)
    expect(traceOf(result, 'script')?.message).toBe('脚本结果无法写入路径 （未配置）')
    expect(outputValue(result, 'script', '脚本结果')).toBe('未写入')
  })

  it('脚本返回假值（false / 0）也算写回成功', async () => {
    const capability = scriptCapability({ value: false })
    const result = await runWorkflow(scriptGraph(), inputRequest(), { capabilities: { runScript: capability.run } })

    expect(traceOf(result, 'script')?.success).toBe(true)
    expect(routeOf(result).scriptResult).toBe(false)
    expect(outputValue(result, 'script', '脚本结果')).toBe(false)
  })

  it('脚本失败时把错误文案带到输出与 trace', async () => {
    const capability = scriptCapability({ success: false, value: undefined, error: 'boom' })
    const result = await runWorkflow(scriptGraph(), inputRequest(), { capabilities: { runScript: capability.run } })

    expect(traceOf(result, 'script')?.success).toBe(false)
    expect(traceOf(result, 'script')?.message).toBe('脚本执行失败：boom')
    expect(outputValue(result, 'script', '脚本结果')).toBe('boom')
    expect(traceDetails(result, 'script').error).toBe('boom')
  })

  it('控制台日志只在脚本真的输出时登记', async () => {
    const withLogs = await runWorkflow(scriptGraph(), inputRequest(), { capabilities: { runScript: scriptCapability({ logs: ['a', 'b'] }).run } })
    expect(outputNames(withLogs, 'script')).toContain('控制台')
    expect(outputValue(withLogs, 'script', '控制台')).toEqual(['a', 'b'])

    const withoutLogs = await runWorkflow(scriptGraph(), inputRequest(), { capabilities: { runScript: scriptCapability().run } })
    expect(outputNames(withoutLogs, 'script')).not.toContain('控制台')
  })

  it('未注入沙箱能力时记为失败并沿 out 端口继续', async () => {
    const result = await runWorkflow(scriptGraph(), inputRequest())

    expect(traceOf(result, 'script')?.success).toBe(false)
    expect(traceOf(result, 'script')?.message).toContain('没有注入该能力')
    expect(result.stopReason).toBe('output')
  })

  it('空脚本不发进沙箱，直接记为失败', async () => {
    const capability = scriptCapability()
    const result = await runWorkflow(scriptGraph({ code: '   ' }), inputRequest(), { capabilities: { runScript: capability.run } })

    expect(capability.calls).toHaveLength(0)
    expect(traceOf(result, 'script')?.message).toBe('脚本执行失败：脚本内容为空')
  })

  it('能力抛出的异常被收敛成失败 trace，不打断整轮运行', async () => {
    const run = async (): Promise<ScriptInvocationResult> => { throw new Error('sandbox exploded') }
    const result = await runWorkflow(scriptGraph(), inputRequest(), { capabilities: { runScript: run } })

    expect(traceOf(result, 'script')?.message).toBe('脚本执行失败：sandbox exploded')
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · LLM 节点', () => {
  function promptGraph(overrides: Partial<NodeOf<'prompt'>> = {}): WorkflowGraph {
    return {
      version: 1,
      nodes: [inputNode(), protocolNode(), promptNode(overrides), outputNode()],
      edges: [
        edge('input', 'out', 'protocol'),
        edge('protocol', 'openai-completions', 'prompt'),
        edge('protocol', 'openai-responses', 'prompt'),
        edge('protocol', 'anthropic-messages', 'prompt'),
        edge('protocol', 'unknown', 'prompt'),
        edge('prompt', 'out', 'output'),
      ],
    }
  }

  it('超时超过上限时按上限夹取', async () => {
    const capability = promptCapability()
    const result = await runWorkflow(promptGraph({ timeoutMilliseconds: PROMPT_TIMEOUT_LIMIT * 3 }), inputRequest(), { capabilities: { runPrompt: capability.run } })

    expect(capability.calls.map(call => call.timeoutMilliseconds)).toEqual([PROMPT_TIMEOUT_LIMIT])
    expect(traceDetails(result, 'prompt').timeoutMilliseconds).toBe(PROMPT_TIMEOUT_LIMIT)
  })

  it('超时不是正有限值时也按上限处理', async () => {
    const capability = promptCapability()
    await runWorkflow(promptGraph({ timeoutMilliseconds: 0 }), inputRequest(), { capabilities: { runPrompt: capability.run } })

    expect(capability.calls[0]?.timeoutMilliseconds).toBe(PROMPT_TIMEOUT_LIMIT)
  })

  it('把这次请求发现到的协议一并交给执行能力', async () => {
    const completions = promptCapability()
    await runWorkflow(promptGraph(), inputRequest({ model: 'gpt-4o-mini' }), { capabilities: { runPrompt: completions.run } })
    expect(completions.calls[0]?.protocol).toBe('openai-completions')

    const responses = promptCapability()
    await runWorkflow(promptGraph(), inputRequest({ model: 'gpt-4o-mini' }, { request: { path: '/v1/responses' } }), { capabilities: { runPrompt: responses.run } })
    expect(responses.calls[0]?.protocol).toBe('openai-responses')
  })

  it('系统提示词与用户提示词都做模板插值', async () => {
    const capability = promptCapability()
    await runWorkflow(
      promptGraph({ systemPrompt: '你是 ${request.method} 请求的助手', promptTemplate: '问题：${request.body.model}；租户：${request.body.tenant}' }),
      inputRequest({ model: 'gpt-4o-mini', tenant: 'vip-cn' }),
      { capabilities: { runPrompt: capability.run } },
    )

    expect(capability.calls[0]?.systemPrompt).toBe('你是 POST 请求的助手')
    expect(capability.calls[0]?.prompt).toBe('问题：gpt-4o-mini；租户：vip-cn')
  })

  it('结果路径为空时不写回，按失败记录', async () => {
    const capability = promptCapability()
    const result = await runWorkflow(promptGraph({ resultPath: '' }), inputRequest(), { capabilities: { runPrompt: capability.run } })

    expect(routeOf(result).reply).toBeUndefined()
    expect(traceOf(result, 'prompt')?.success).toBe(false)
    expect(traceOf(result, 'prompt')?.message).toBe('LLM 回复无法写入路径 （未配置）')
    expect(outputValue(result, 'prompt', '回复')).toBe('未写入')
  })

  it('没有选择逻辑模型时不调用能力并记为失败', async () => {
    const capability = promptCapability()
    const result = await runWorkflow(promptGraph({ logicalModelId: '  ' }), inputRequest(), { capabilities: { runPrompt: capability.run } })

    expect(capability.calls).toHaveLength(0)
    expect(traceOf(result, 'prompt')?.message).toBe('LLM 节点尚未选择逻辑模型')
  })

  it('未注入执行能力时记为失败并沿 out 端口继续', async () => {
    const result = await runWorkflow(promptGraph(), inputRequest())

    expect(traceOf(result, 'prompt')?.success).toBe(false)
    expect(traceOf(result, 'prompt')?.message).toContain('没有注入该能力')
    expect(result.stopReason).toBe('output')
  })

  it('能力抛出的异常被收敛成失败 trace，不打断整轮运行', async () => {
    const run = async (): Promise<PromptInvocationResult> => { throw new Error('upstream timeout') }
    const result = await runWorkflow(promptGraph(), inputRequest(), { capabilities: { runPrompt: run } })

    expect(traceOf(result, 'prompt')?.message).toBe('LLM 节点执行失败：upstream timeout')
    expect(result.stopReason).toBe('output')
  })
})

describe('内置节点 · 输出节点', () => {
  function outputGraph(output: Partial<NodeOf<'output'>>, modelIds: string[]): WorkflowGraph {
    return {
      version: 1,
      nodes: [inputNode(), modelSelectNode({ modelIds }), outputNode(output)],
      edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'output')],
    }
  }

  it('includeTrace / summaryLevel 原样进 trace 详情', async () => {
    const result = await runWorkflow(outputGraph({ includeTrace: false, summaryLevel: 'brief' }, ['model-a']), inputRequest())

    expect(traceDetails(result, 'output')).toEqual({ modelIds: ['model-a'], fallback: false, includeTrace: false, summaryLevel: 'brief' })
  })

  it('没有落点时记为失败并说明原因', async () => {
    const result = await runWorkflow(outputGraph({}, []), inputRequest())

    expect(traceOf(result, 'output')?.success).toBe(false)
    expect(traceOf(result, 'output')?.message).toBe('到达输出节点，但没有得到任何可用逻辑模型')
    expect(outputValue(result, 'output', '最终落点')).toEqual([])
    expect(result.stopReason).toBe('output')
  })

  it('落点非空时汇报落点，兜底来源标注在输出上', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        inputNode(),
        modelSelectNode({ id: 'fallback', source: 'variable', variablePath: 'request.body.model', fallbackModelIds: ['model-default'] }),
        outputNode(),
      ],
      edges: [edge('input', 'out', 'fallback'), edge('fallback', 'out', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest({}))

    expect(outputValue(result, 'output', '最终落点')).toEqual(['model-default'])
    expect(outputNote(result, 'output', '最终落点')).toBe('兜底')
    expect(traceOf(result, 'output')?.message).toBe('到达输出节点，落点逻辑模型 model-default')
    expect(traceOf(result, 'output')?.success).toBe(true)
  })

  it('画布上禁用输出节点也照常收口', async () => {
    const result = await runWorkflow(outputGraph({ enabled: false }, ['model-a']), inputRequest())

    expect(outputValue(result, 'output', '最终落点')).toEqual(['model-a'])
    expect(result.stopReason).toBe('output')
  })

  it('out 端口没有连线时 stopReason 是 missing-next', async () => {
    const graph: WorkflowGraph = { version: 1, nodes: [inputNode(), modelSelectNode({ modelIds: ['model-a'] })], edges: [edge('input', 'out', 'model-select')] }

    const result = await runWorkflow(graph, inputRequest())

    expect(result.stopReason).toBe('missing-next')
  })
})

describe('内置节点 · 引擎导出的路径与决策工具', () => {
  it('getByPath 支持通配投影并拍平一层', () => {
    expect(getByPath({ logicalModels: [{ modelId: 'a' }, { modelId: 'b' }] }, 'logicalModels[*].modelId')).toEqual(['a', 'b'])
    expect(getByPath({ a: { b: [{ c: 1 }, { c: 2 }, {}] } }, 'a.b[*].c')).toEqual([1, 2])
    expect(getByPath({ a: [{ b: [1, 2] }, { b: [3] }] }, 'a[*].b')).toEqual([1, 2, 3])
    expect(getByPath({ items: [{ tags: ['x', 'y'] }] }, 'items[*].tags[*]')).toEqual(['x', 'y'])
  })

  it('getByPath 对缺失路径、非数组通配、空路径一律返回 undefined', () => {
    expect(getByPath({ a: 1 }, 'a.b')).toBeUndefined()
    expect(getByPath({ a: 'scalar' }, 'a[*].b')).toBeUndefined()
    expect(getByPath({ a: 1 }, 'a[*]')).toBeUndefined()
    expect(getByPath({ a: 1 }, '')).toBeUndefined()
    expect(getByPath({ a: 1 }, '   ')).toBeUndefined()
    expect(getByPath({ a: 1 }, '..a..')).toBe(1)
  })

  it('getByPath 取标量 / 数组整体时不展开', () => {
    expect(getByPath({ a: 1 }, 'a')).toBe(1)
    expect(getByPath({ a: [1, 2] }, 'a')).toEqual([1, 2])
    expect(getByPath({ a: [1, 2] }, 'a[*]')).toEqual([1, 2])
    expect(getByPath({ a: null }, 'a')).toBeNull()
  })

  it('readRouteDecision 只认对象形态的 route', () => {
    expect(readRouteDecision(undefined)).toBeNull()
    expect(readRouteDecision(null)).toBeNull()
    expect(readRouteDecision('string')).toBeNull()
    expect(readRouteDecision({})).toBeNull()
    expect(readRouteDecision({ route: null })).toBeNull()
    expect(readRouteDecision({ route: 'nope' })).toBeNull()

    const route = { traceId: 't', protocol: 'unknown', transport: 'http', modelIds: ['a'], fallback: false, controls: {} }
    expect(readRouteDecision({ route })).toEqual(route)
  })

  it('readLandingModelIds 归一化落点，决策缺失时给空数组', () => {
    expect(readLandingModelIds(undefined)).toEqual([])
    expect(readLandingModelIds({})).toEqual([])
    expect(readLandingModelIds({ route: { modelIds: 'not-array' } })).toEqual([])
    expect(readLandingModelIds({ route: { modelIds: [' model-a ', 'model-a', '', 'model-b'] } })).toEqual(['model-a', 'model-b'])
  })

  it('createRouteContextInput 采信调用方给出的协议、传输形态与 traceId', () => {
    const envelope = createRouteContextInput({
      request: { path: '/v1/messages' },
      protocol: 'anthropic-messages',
      transport: 'http-stream',
      metadata: { traceId: 'trace-from-caller' },
      logicalModels: [
        { modelId: 'model-a', enabled: true },
        { modelId: 'model-b', enabled: false },
      ],
    })

    expect(envelope.context.traceId).toBe('trace-from-caller')
    expect(envelope.context.logicalModels).toEqual([
      { modelId: 'model-a', enabled: true },
      { modelId: 'model-b', enabled: false },
    ])
    expect(envelope.payload.route).toMatchObject({ traceId: 'trace-from-caller', protocol: 'anthropic-messages', transport: 'http-stream' })
  })

  it('createRouteContextInput 丢弃缺少模型 id 的逻辑模型，并补全缺省字段', () => {
    const envelope = createRouteContextInput({
      request: {},
      logicalModels: [
        { modelId: '', enabled: true },
        { modelId: 'model-b', enabled: true },
        { modelId: ' model-c ', enabled: true },
        'not-an-object',
      ] as unknown as RuntimeLogicalModel[],
    })

    expect(envelope.context.logicalModels).toEqual([
      { modelId: 'model-b', enabled: true },
      { modelId: 'model-c', enabled: true },
    ])
    expect(envelope.context.traceId).toMatch(/^trace-/)
    expect(envelope.payload.logicalModels).toEqual([
      { modelId: 'model-b', enabled: true },
      { modelId: 'model-c', enabled: true },
    ])
  })

  it('一次运行结束后调用方能从 payload 直接读出决策与落点', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [inputNode(), protocolNode(), modelSelectNode({ modelIds: ['model-a'] }), outputNode()],
      edges: [edge('input', 'out', 'protocol'), edge('protocol', 'openai-completions', 'model-select'), edge('model-select', 'out', 'output')],
    }

    const result = await runWorkflow(graph, inputRequest({ model: 'gpt-4o-mini' }))

    expect(readRouteDecision(result.outputPayload)).toMatchObject({ protocol: 'openai-completions', transport: 'http' })
    expect(readLandingModelIds(result.outputPayload)).toEqual(['model-a'])
  })

  it('metadata 归调用方所有：引擎只读不写', async () => {
    const graph: WorkflowGraph = { version: 1, nodes: [inputNode(), outputNode()], edges: [edge('input', 'out', 'output')] }

    const result = await runWorkflow(graph, inputRequest({}, { metadata: { traceId: 'trace-1', custom: { keep: true } } }))

    expect((result.outputPayload as { metadata: Record<string, unknown> }).metadata).toEqual({ traceId: 'trace-1', custom: { keep: true } })
  })
})
