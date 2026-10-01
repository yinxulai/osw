import { describe, expect, it } from 'vitest'
import { runWorkflow } from './engine'
import {
  createConditionCase,
  createConditionRule,
  createControlItem,
  createBlankGraph,
  createDefaultPolicyGraph,
  createId,
  createInputNode,
  createLlmComplexityGraph,
  createOutputNode,
  createScriptRoutingGraph,
  createUserAgentGraph,
  findPolicyPreset,
  getOperatorsByType,
  isSameGraph,
  ROUTER_POLICY_PRESETS,
  samplePayload,
  withFixedNodeCopy,
} from './presets'
import {
  ALL_CONDITION_OPERATORS,
  FIELD_OPERAND_OPERATORS,
  type ConditionRule,
  type PromptInvocation,
  type PromptInvocationResult,
  type RuntimeLogicalModel,
  type SchemaValueType,
  type ScriptInvocation,
  type ScriptInvocationResult,
  type WorkflowGraph,
  type WorkflowNodeModel,
  type WorkflowProtocol,
  type WorkflowRequestPayload,
  type WorkflowRunResult,
} from './types'

/**
 * 内置策略（预设）验收。
 *
 * 这里不重复 `graph-ops.test.ts` 已经锁住的「结构契约」（节点集合、端口、落点取值），
 * 只补**运行行为**：同一张预设图在不同协议、不同请求、不同能力注入下落到了哪里。
 * 预设是用户点一下就会真正跑起来的图，结构对但跑不对等于没有。
 */

const presetModels: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'model-fast', enabled: true },
  { modelId: 'model-smart', enabled: true },
]

/** 兜底落点（'default' 是内建默认逻辑模型）。 */
const fallbackModelId = 'default'
/** 按 `resolveLandingModelIds` 的顺序：第 0 个分流落点、第 1 个分流落点。 */
const firstLanding = 'model-fast'
const secondLanding = 'model-smart'

const presetGraph = {
  'model-direct': () => createDefaultPolicyGraph(presetModels),
  'ua-source-routing': () => createUserAgentGraph(presetModels),
  'llm-complexity-routing': () => createLlmComplexityGraph(presetModels),
  'script-routing': () => createScriptRoutingGraph(presetModels),
}

function requestOf(request: WorkflowRequestPayload, extra: Record<string, unknown> = {}) {
  return { request, logicalModels: presetModels, ...extra }
}

function traceOf(result: WorkflowRunResult, nodeId: string) {
  return result.trace.find(item => item.nodeId === nodeId)
}

function traceDetails(result: WorkflowRunResult, nodeId: string): Record<string, unknown> {
  return (traceOf(result, nodeId)?.details ?? {}) as Record<string, unknown>
}

function routeOf(result: WorkflowRunResult): Record<string, unknown> {
  return (result.outputPayload as { route: Record<string, unknown> }).route
}

function landingOf(result: WorkflowRunResult): unknown {
  return (result.nodeOutputs.output ?? []).find(item => item.name === '最终落点')?.value
}

function scriptCapability(overrides: Partial<ScriptInvocationResult> = {}) {
  const calls: ScriptInvocation[] = []
  const run = async (invocation: ScriptInvocation): Promise<ScriptInvocationResult> => {
    calls.push(invocation)
    return { success: true, value: 'simple', logs: [], durationMilliseconds: 3, ...overrides }
  }
  return { calls, run }
}

function promptCapability(overrides: Partial<PromptInvocationResult> = {}) {
  const calls: PromptInvocation[] = []
  const run = async (invocation: PromptInvocation): Promise<PromptInvocationResult> => {
    calls.push(invocation)
    return { success: true, text: 'simple', durationMilliseconds: 4, ...overrides }
  }
  return { calls, run }
}

describe('预设工厂', () => {
  it('createId 带前缀且逐次不同', () => {
    const first = createId('node')
    const second = createId('node')

    expect(first).toMatch(/^node-\d+-[0-9a-f]+$/)
    expect(second).not.toBe(first)
  })

  it('新建条件的默认字段只能是输入节点保证得了的请求行', () => {
    const rule = createConditionRule()

    expect(rule).toEqual({ fieldPath: 'request.method', valueType: 'string', operator: 'equals', valueSource: 'literal', valueFieldPath: '', value: 'POST' })
    // 请求体是协议层的事实，输入节点不解析它 —— 默认条件不能指向 request.body。
    expect(rule.fieldPath.startsWith('request.body')).toBe(false)
  })

  it('新建分支的默认形态：单条规则、and 组合、可指定 id', () => {
    expect(createConditionCase('case-1')).toEqual({ id: 'case-1', name: '分支 1', logicalOperator: 'and', conditions: [createConditionRule()] })
    expect(createConditionCase().id).toMatch(/^case-/)
  })

  it('switch 控制项：布尔取值、无候选项', () => {
    const item = createControlItem('switch')

    expect(item).toMatchObject({ key: 'featureEnabled', label: '功能开关', kind: 'switch', enabled: true, defaultValue: true })
    expect(item.options).toBeUndefined()
    expect(item.id).toMatch(/^control-/)
  })

  it('select 控制项：默认值必须落在候选项里', () => {
    const item = createControlItem('select')

    expect(item).toMatchObject({ key: 'routeMode', label: '路由模式', kind: 'select', enabled: true, defaultValue: 'balanced' })
    expect(item.options?.map(option => option.value)).toContain(item.defaultValue)
    expect(item.options?.every(option => option.label.trim() !== '' && option.value.trim() !== '')).toBe(true)
  })

  const valueTypes: SchemaValueType[] = ['string', 'number', 'boolean', 'enum', 'array', 'object', 'unknown']

  it.each(valueTypes)('字段类型 %s 推荐的操作符都来自内置清单且非空', (type) => {
    const operators = getOperatorsByType(type)

    expect(operators.length).toBeGreaterThan(0)
    for (const operator of operators) expect(ALL_CONDITION_OPERATORS).toContain(operator)
  })

  it('类型未知时不收窄操作符（交给运行时判定）', () => {
    expect([...getOperatorsByType('unknown')].sort()).toEqual([...ALL_CONDITION_OPERATORS].sort())
  })

  it('固定节点的文案由 withFixedNodeCopy 统一改写', () => {
    const nodes: WorkflowNodeModel[] = [
      createInputNode({ x: 0, y: 0 }),
      createOutputNode({ x: 0, y: 0 }),
      { id: 'extra', kind: 'protocol-discovery', name: '随便起的名字', enabled: true, description: '随便写的描述', position: { x: 0, y: 0 } },
    ]

    const next = withFixedNodeCopy(nodes)

    expect(next[0]?.name).toBe('输入请求')
    expect(next[1]?.name).toBe('路由结果出口')
    // 非固定节点原样保留（连对象身份都不换）。
    expect(next[2]).toBe(nodes[2])
  })

  it('固定节点文案已经正确时原样返回同一份数组与同一批对象', () => {
    const nodes: WorkflowNodeModel[] = [createInputNode({ x: 0, y: 0 }), createOutputNode({ x: 0, y: 0 })]

    expect(withFixedNodeCopy(nodes)).toBe(nodes)
  })

  it('固定节点的 id 与出口默认值稳定', () => {
    expect(createInputNode({ x: 1, y: 2 })).toMatchObject({ id: 'input', kind: 'input', enabled: true, position: { x: 1, y: 2 } })
    expect(createOutputNode({ x: 3, y: 4 })).toMatchObject({ id: 'output', kind: 'output', enabled: true, includeTrace: true, summaryLevel: 'detailed', position: { x: 3, y: 4 } })
  })
})

describe('空白脚手架图', () => {
  it('认不出协议时直接进逻辑模型选择，其余三种协议都要先过条件', () => {
    const graph = createBlankGraph()
    const protocolEdges = graph.edges.filter(item => item.sourceNodeId === 'protocol')
    const byPort = new Map(protocolEdges.map(item => [item.sourcePort, item.targetNodeId]))

    expect(byPort.get('unknown')).toBe('model')
    expect(byPort.get('openai-completions')).toBe('condition')
    expect(byPort.get('openai-responses')).toBe('condition')
    expect(byPort.get('anthropic-messages')).toBe('condition')
  })

  it('两条分支（命中 / ELSE）都通向同一个逻辑模型选择节点', () => {
    const graph = createBlankGraph()
    const conditionEdges = graph.edges.filter(item => item.sourceNodeId === 'condition')

    expect(conditionEdges.map(item => item.sourcePort).sort()).toEqual(['case-1', 'else'])
    expect(conditionEdges.every(item => item.targetNodeId === 'model')).toBe(true)
  })

  it('每次生成都是新对象、内容完全一致（否则生成结果之间永远比对不相等）', () => {
    const first = createBlankGraph()
    const second = createBlankGraph()

    expect(first).not.toBe(second)
    expect(isSameGraph(first, second)).toBe(true)
  })

  it('这张图能直接跑：没有选落点时如实报「没有可用逻辑模型」而不是崩', async () => {
    const result = await runWorkflow(createBlankGraph(), samplePayload)

    expect(result.stopReason).toBe('output')
    expect(traceOf(result, 'output')?.success).toBe(false)
    expect(routeOf(result).modelIds).toEqual([])
  })
})

describe('内置策略 · 示例输入', () => {
  it('示例输入是一份真实可跑的 OpenAI Chat Completions 请求', () => {
    expect(samplePayload.request.path).toBe('/v1/chat/completions')
    expect(samplePayload.request.method).toBe('POST')
    expect(samplePayload.request.headers['content-type']).toContain('application/json')
    expect(samplePayload.request.headers['user-agent']).toContain('Cursor')
    expect(samplePayload.request.body.model).toBe('gpt-4o-mini')
    expect(Array.isArray(samplePayload.request.body.messages)).toBe(true)
    expect(Array.isArray(samplePayload.request.body.tools)).toBe(true)
  })

  it.each(ROUTER_POLICY_PRESETS.map(preset => preset.id))('示例输入 %s 预设能跑到出口', async (presetId) => {
    const result = await runWorkflow(presetGraph[presetId](), samplePayload)

    expect(result.stopReason).toBe('output')
    expect(traceOf(result, 'output')).toBeDefined()
  })
})

describe('内置策略 · 默认策略（请求模型命中即直连）', () => {
  const protocolCases: Array<[WorkflowProtocol, WorkflowRequestPayload]> = [
    ['openai-completions', { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: secondLanding, messages: [] } }],
    ['openai-responses', { path: '/v1/responses', headers: {}, body: { model: secondLanding, input: [] } }],
    ['anthropic-messages', { path: '/v1/messages', headers: {}, body: { model: secondLanding, messages: [] } }],
    ['unknown', { path: '/v1/embeddings', headers: {}, body: { model: secondLanding } }],
  ]

  it.each(protocolCases)('协议 %s 下请求模型在列表里就直连它', async (protocol, request) => {
    const result = await runWorkflow(createDefaultPolicyGraph(presetModels), requestOf(request))

    expect(result.protocol).toBe(protocol)
    expect(routeOf(result).modelIds).toEqual([secondLanding])
    expect(routeOf(result).fallback).toBe(false)
    expect(traceDetails(result, 'condition').sourcePort).toBe('case-1')
    expect(landingOf(result)).toEqual([secondLanding])
  })

  it('请求模型不在列表里时落到兜底逻辑模型', async () => {
    const result = await runWorkflow(createDefaultPolicyGraph(presetModels), requestOf(samplePayload.request))

    expect(samplePayload.request.body.model).not.toBe(fallbackModelId)
    expect(routeOf(result).modelIds).toEqual([fallbackModelId])
    expect(traceDetails(result, 'condition').sourcePort).toBe('else')
    expect(traceOf(result, 'condition')?.message).toBe('未命中任何分支，走 ELSE')
  })

  it('请求模型是空串时同样落到兜底逻辑模型', async () => {
    const result = await runWorkflow(createDefaultPolicyGraph(presetModels), requestOf({ path: '/v1/chat/completions', body: { model: '' } }))

    expect(routeOf(result).modelIds).toEqual([fallbackModelId])
    expect(traceDetails(result, 'condition').sourcePort).toBe('else')
  })

  it('兜底落点是内建默认逻辑模型，直连落点是请求里写的那一个', () => {
    const graph = createDefaultPolicyGraph(presetModels)
    const direct = graph.nodes.find(node => node.id === 'model-direct')
    const fallback = graph.nodes.find(node => node.id === 'model-default')

    expect(fallback).toMatchObject({ source: 'fixed', modelIds: [fallbackModelId] })
    expect(direct).toMatchObject({ source: 'variable', variablePath: 'request.body.model' })
  })
})

describe('内置策略 · UA 来源分流', () => {
  it('头值里出现客户端标识就命中对应分支，并持续遍历到命中的那一轮', async () => {
    const result = await runWorkflow(
      createUserAgentGraph(presetModels),
      requestOf({ path: '/v1/chat/completions', headers: { 'x-noise': 'Mozilla/5.0', 'x-client': 'Cursor/1.0' }, body: {} }),
    )

    expect(routeOf(result).modelIds).toEqual([firstLanding])
    expect(routeOf(result).fallback).toBe(false)
    expect(traceDetails(result, 'iteration').executed).toBe(2)
    // 请求头是对象，命中键是头名。
    expect(traceDetails(result, 'iteration').hitKeys).toEqual(['x-client'])
    expect(landingOf(result)).toEqual([firstLanding])
  })

  it('第二个分支（Claude CLI）落到第二个分流落点', async () => {
    const result = await runWorkflow(
      createUserAgentGraph(presetModels),
      requestOf({ path: '/v1/chat/completions', headers: { 'user-agent': 'claude-cli/1.0.0' }, body: {} }),
    )

    expect(routeOf(result).modelIds).toEqual([secondLanding])
    expect(traceDetails(result, 'iteration').executed).toBe(1)
  })

  it('头值同时命中两个标识时按分支声明顺序取前者', async () => {
    const result = await runWorkflow(
      createUserAgentGraph(presetModels),
      requestOf({ path: '/v1/chat/completions', headers: { 'user-agent': 'Cursor/1.0 (claude-cli compatible)' }, body: {} }),
    )

    expect(routeOf(result).modelIds).toEqual([firstLanding])
    expect(traceDetails(result, 'ua-condition').sourcePort).toBe('case-cursor')
  })

  it('一个头都没命中时回落到兜底逻辑模型，且不被空数组覆盖', async () => {
    const result = await runWorkflow(
      createUserAgentGraph(presetModels),
      requestOf({ path: '/v1/chat/completions', headers: { 'user-agent': 'Mozilla/5.0', 'x-noise': 'curl/8.0' }, body: {} }),
    )

    expect(routeOf(result).fallback).toBe(true)
    expect(routeOf(result).modelIds).toEqual([fallbackModelId])
    expect(traceDetails(result, 'iteration').hitCount).toBe(0)
    expect(traceDetails(result, 'iteration').executed).toBe(2)
    expect(landingOf(result)).toEqual([fallbackModelId])
  })

  it('没有任何请求头时一轮都不执行，直接走兜底', async () => {
    const result = await runWorkflow(createUserAgentGraph(presetModels), requestOf({ path: '/v1/chat/completions', body: {} }))

    expect(traceDetails(result, 'iteration').itemCount).toBe(0)
    expect(routeOf(result).modelIds).toEqual([fallbackModelId])
    expect(routeOf(result).fallback).toBe(true)
  })

  it('迭代的 resultPath 留空，所以循环体写下的落点不会被汇总结果盖掉', () => {
    const graph = createUserAgentGraph(presetModels)
    const iteration = graph.nodes.find(node => node.id === 'iteration')

    expect(iteration).toMatchObject({ resultPath: '', collectPath: 'route.modelIds', collectMode: 'first' })
  })
})

describe('内置策略 · LLM 复杂度分流', () => {
  it('LLM 回答 complex 时落到复杂分支', async () => {
    const capability = promptCapability({ text: 'complex' })
    const result = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runPrompt: capability.run } })

    expect(routeOf(result).complexity).toBe('complex')
    expect(routeOf(result).modelIds).toEqual([firstLanding])
    expect(traceDetails(result, 'complexity-condition').sourcePort).toBe('case-complex')
  })

  it('LLM 回答 simple 时落到其余分支', async () => {
    const capability = promptCapability({ text: 'simple' })
    const result = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runPrompt: capability.run } })

    expect(routeOf(result).modelIds).toEqual([secondLanding])
    expect(traceDetails(result, 'complexity-condition').sourcePort).toBe('else')
  })

  it('正则判定容忍多余文本与首字母大小写，但不认全大写', async () => {
    const loose = promptCapability({ text: '这个词是 Complex 吗？\n' })
    const matched = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runPrompt: loose.run } })
    expect(routeOf(matched).modelIds).toEqual([firstLanding])

    const upper = promptCapability({ text: 'COMPLEX' })
    const missed = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runPrompt: upper.run } })
    expect(routeOf(missed).modelIds).toEqual([secondLanding])
  })

  it('判定用的逻辑模型是预设生成时定好的兜底逻辑模型', async () => {
    const capability = promptCapability()
    const result = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runPrompt: capability.run } })

    expect(capability.calls[0]?.logicalModelId).toBe(fallbackModelId)
    expect(traceDetails(result, 'complexity-prompt').logicalModelId).toBe(fallbackModelId)
  })

  it('提示词插的是整个请求体，不需要协议发现节点', async () => {
    const capability = promptCapability()
    const graph = createLlmComplexityGraph(presetModels)
    await runWorkflow(graph, requestOf(samplePayload.request), { capabilities: { runPrompt: capability.run } })

    expect(graph.nodes.some(node => node.kind === 'protocol-discovery')).toBe(false)
    expect(capability.calls[0]?.prompt).toContain('gpt-4o-mini')
    expect(capability.calls[0]?.prompt).toContain(samplePayload.request.body.tenant)
  })

  it('没有注入 LLM 能力时读不到判定值，走「其余」分支而不是停住', async () => {
    const result = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request))

    expect(traceOf(result, 'complexity-prompt')?.success).toBe(false)
    expect(routeOf(result).modelIds).toEqual([secondLanding])
    expect(result.stopReason).toBe('output')
  })

  it('LLM 调用失败时同样走「其余」分支', async () => {
    const capability = promptCapability({ success: false, text: '', error: 'upstream timeout' })
    const result = await runWorkflow(createLlmComplexityGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runPrompt: capability.run } })

    expect(traceOf(result, 'complexity-prompt')?.success).toBe(false)
    expect(routeOf(result).modelIds).toEqual([secondLanding])
  })
})

describe('内置策略 · JS 脚本分流', () => {
  it('脚本返回 complex 时落到复杂分支，并把判定过程留在 trace 里', async () => {
    const capability = scriptCapability({ value: 'complex', logs: ['复杂度判定'] })
    const result = await runWorkflow(createScriptRoutingGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runScript: capability.run } })

    expect(routeOf(result).complexity).toBe('complex')
    expect(routeOf(result).modelIds).toEqual([firstLanding])
    expect((result.nodeOutputs['complexity-script'] ?? []).find(item => item.name === '控制台')?.value).toEqual(['复杂度判定'])
  })

  it.each([
    ['simple', secondLanding],
    ['', secondLanding],
    ['COMPLEX', secondLanding],
  ])('脚本返回 %s 时落到其余分支（判定是精确等于）', async (returned, expectedLanding) => {
    const capability = scriptCapability({ value: returned })
    const result = await runWorkflow(createScriptRoutingGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runScript: capability.run } })

    expect(routeOf(result).modelIds).toEqual([expectedLanding])
    expect(traceDetails(result, 'complexity-condition').sourcePort).toBe('else')
  })

  it('没有注入沙箱能力时读不到判定值，走「其余」分支而不是停住', async () => {
    const result = await runWorkflow(createScriptRoutingGraph(presetModels), requestOf(samplePayload.request))

    expect(traceOf(result, 'complexity-script')?.success).toBe(false)
    expect(routeOf(result).modelIds).toEqual([secondLanding])
    expect(result.stopReason).toBe('output')
  })

  it('脚本从 route.protocol 读到协议发现写下的那个协议（四种分支都通）', async () => {
    const protocolCases: Array<[WorkflowProtocol, WorkflowRequestPayload]> = [
      ['openai-completions', { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { messages: [] } }],
      ['openai-responses', { path: '/v1/responses', headers: {}, body: { input: [] } }],
      ['anthropic-messages', { path: '/v1/messages', headers: {}, body: { messages: [] } }],
      ['unknown', { path: '/v1/embeddings', headers: {}, body: {} }],
    ]

    for (const [protocol, request] of protocolCases) {
      const capability = scriptCapability({ value: 'complex' })
      const result = await runWorkflow(createScriptRoutingGraph(presetModels), requestOf(request), { capabilities: { runScript: capability.run } })

      expect(result.protocol).toBe(protocol)
      expect(capability.calls).toHaveLength(1)
      expect((capability.calls[0]?.payload as { route: Record<string, unknown> }).route.protocol).toBe(protocol)
      // 四种协议都必须接上脚本节点：认不出协议也要按同一套策略兜底。
      expect(traceOf(result, 'complexity-script')?.success).toBe(true)
      expect(routeOf(result).modelIds).toEqual([firstLanding])
    }
  })

  it('脚本失败时读不到判定值，走「其余」分支', async () => {
    const capability = scriptCapability({ success: false, value: undefined, error: 'boom' })
    const result = await runWorkflow(createScriptRoutingGraph(presetModels), requestOf(samplePayload.request), { capabilities: { runScript: capability.run } })

    expect(traceOf(result, 'complexity-script')?.success).toBe(false)
    expect(routeOf(result).complexity).toBeUndefined()
    expect(routeOf(result).modelIds).toEqual([secondLanding])
  })
})

describe('内置策略 · 边界与退化', () => {
  it.each(ROUTER_POLICY_PRESETS.map(preset => preset.id))('没有任何可用逻辑模型时 %s 仍能跑到出口', async (presetId) => {
    // 图必须按「空模型列表」生成：预设的落点是生成时定好的，换模型列表就得重新生成。
    const emptyGraph = findPolicyPreset(presetId)?.createGraph([]) as WorkflowGraph
    const result = await runWorkflow(
      emptyGraph,
      { request: samplePayload.request, logicalModels: [] },
      { capabilities: { runScript: scriptCapability({ value: 'complex' }).run, runPrompt: promptCapability({ text: 'complex' }).run } },
    )

    // 没有可用的落点，但运行本身不能断：出口如实报「没有可用逻辑模型」。
    expect(result.stopReason).toBe('output')
    expect(traceOf(result, 'output')?.success).toBe(false)
    expect(traceOf(result, 'output')?.message).toBe('到达输出节点，但没有得到任何可用逻辑模型')
    expect(routeOf(result).modelIds).toEqual([])
  })

  it.each(ROUTER_POLICY_PRESETS.map(preset => preset.id))('只剩一个已启用模型时 %s 的每条分支都落到它，不留死落点', async (presetId) => {
    const onlyModel: RuntimeLogicalModel[] = [{ modelId: 'only', enabled: true }]
    const preset = findPolicyPreset(presetId)
    const graph = preset?.createGraph(onlyModel) as WorkflowGraph
    const nodeIdsWithLanding = graph.nodes.filter(node => node.kind === 'model-select').map(node => node.id)

    for (const nodeId of nodeIdsWithLanding) {
      const node = graph.nodes.find(item => item.id === nodeId)
      if (node?.kind !== 'model-select') continue
      // 固定落点必须已经是一个有内容的真 id，否则预设一上手就是「死落点」。
      if (node.source === 'fixed') expect(node.modelIds, nodeId).toEqual(['only'])
      // 变量落点读的是运行数据，至少得有一个取值路径。
      else expect(node.variablePath.trim(), nodeId).not.toBe('')
    }

    const result = await runWorkflow(
      graph,
      { request: samplePayload.request, logicalModels: onlyModel },
      { capabilities: { runScript: scriptCapability({ value: 'complex' }).run, runPrompt: promptCapability({ text: 'complex' }).run } },
    )

    expect(result.stopReason).toBe('output')
    expect(routeOf(result).modelIds).toEqual(['only'])
  })

  it.each(ROUTER_POLICY_PRESETS.map(preset => preset.id))('模型全部停用时 %s 与没有模型一样，落点为空', async (presetId) => {
    const disabledModels: RuntimeLogicalModel[] = [{ modelId: 'default', enabled: false }]
    const preset = findPolicyPreset(presetId)
    const result = await runWorkflow(preset?.createGraph(disabledModels) as WorkflowGraph, { request: samplePayload.request, logicalModels: disabledModels })

    expect(result.stopReason).toBe('output')
    expect(routeOf(result).modelIds).toEqual([])
  })
})

describe('内置策略 · 注册表一致性', () => {
  it('每次生成内容一致但对象不同', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      const first = preset.createGraph(presetModels)
      const second = preset.createGraph(presetModels)

      expect(first, preset.id).not.toBe(second)
      expect(isSameGraph(first, second), preset.id).toBe(true)
    }
  })

  it('isSameGraph 只比内容：节点名与连线端口变了都要判成不同', () => {
    const graph = createDefaultPolicyGraph(presetModels)
    const renamed = createDefaultPolicyGraph(presetModels)
    renamed.nodes[2].name = '换了个名字'
    expect(isSameGraph(graph, renamed)).toBe(false)

    const rewired = createDefaultPolicyGraph(presetModels)
    const conditionEdge = rewired.edges.find(item => item.sourceNodeId === 'condition' && item.sourcePort === 'else')
    if (conditionEdge) conditionEdge.targetNodeId = 'output'
    expect(isSameGraph(graph, rewired)).toBe(false)
  })

  it('findPolicyPreset 命中注册表里的每一项，未知 id 给 undefined', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      expect(findPolicyPreset(preset.id)).toBe(preset)
    }
    expect(findPolicyPreset('nope')).toBeUndefined()
  })

  it('四条预设的落点都来自传入的逻辑模型列表', () => {
    const knownIds = new Set(presetModels.map(model => model.modelId))

    for (const preset of ROUTER_POLICY_PRESETS) {
      const graph = preset.createGraph(presetModels)
      const landingIds = graph.nodes.flatMap(node => (node.kind === 'model-select' ? [...node.modelIds, ...node.fallbackModelIds] : []))

      expect(landingIds.length, preset.id).toBeGreaterThan(0)
      for (const id of landingIds) expect(knownIds, `${preset.id}: ${id}`).toContain(id)
    }
  })

  it('四条预设里的条件规则都自洽：字段操作数有路径，字面量有比较值', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      const rules: ConditionRule[] = preset
        .createGraph(presetModels)
        .nodes.flatMap(node => (node.kind === 'condition' ? node.cases.flatMap(item => item.conditions) : []))

      expect(rules.length, preset.id).toBeGreaterThan(0)
      for (const rule of rules) {
        expect(rule.fieldPath.trim(), preset.id).not.toBe('')
        expect(ALL_CONDITION_OPERATORS, preset.id).toContain(rule.operator)
        if (rule.valueSource === 'field') {
          // 只允许对支持字段操作数的操作符配置字段操作数。
          expect(FIELD_OPERAND_OPERATORS, `${preset.id}: ${rule.operator}`).toContain(rule.operator)
          expect(String(rule.valueFieldPath ?? '').trim(), `${preset.id}: ${rule.operator}`).not.toBe('')
        }
      }
    }
  })
})
