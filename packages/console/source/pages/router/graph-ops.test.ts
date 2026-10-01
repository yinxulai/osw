import { describe, expect, it } from 'vitest'
import { runWorkflow } from '@common/router/engine'
import { appendNode, cloneNode, connectEdge, insertNode, portKey, primarySourcePort, removeEdges, removeNode, resolveInsertAnchor } from './graph-ops'
import { createBlankGraph, createDefaultPolicyGraph, createLlmComplexityGraph, createNodeByKind, createPresetModelPool, createUserAgentGraph, findPolicyPreset, resolveLandingModelIds, ROUTER_POLICY_PRESETS } from '@common/router/presets'
import { APPENDABLE_KINDS } from './node-meta'
import { WorkflowGraphSchema } from '@common/router/schemas'
import type { ConditionNode, ControlInputNode, RuntimeLogicalModel, WorkflowGraph, WorkflowNodeModel } from '@common/router/types'

/**
 * 图操作回归测试。
 * 这些函数是画布与路由引擎之间唯一的写入口，任何改动都必须保持
 * 「一个 source 端口最多一条出边」这一引擎前提。
 */

/** 预设生成用的逻辑模型列表：`default` 是兜底落点，另两个给分流落点用。 */
const presetLogicalModels: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'model-fast', enabled: true },
  { modelId: 'model-smart', enabled: true },
]

function nodeById(graph: WorkflowGraph, nodeId: string): WorkflowNodeModel {
  const node = graph.nodes.find(item => item.id === nodeId)
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  return node
}

function conditionOf(graph: WorkflowGraph): ConditionNode {
  const node = nodeById(graph, 'condition')
  if (node.kind !== 'condition') throw new Error('condition 节点类型不匹配')
  return node
}

function controlInputOf(graph: WorkflowGraph): ControlInputNode {
  const node = graph.nodes.find(item => item.kind === 'control-input')
  if (!node || node.kind !== 'control-input') throw new Error('control-input 节点不存在')
  return node
}

/** 校验引擎前提：同一个 source 端口上不允许出现多条出边。 */
function expectUniqueSourcePorts(graph: WorkflowGraph) {
  const keys = graph.edges.map(edge => portKey(edge.sourceNodeId, String(edge.sourcePort)))
  expect(new Set(keys).size).toBe(keys.length)
}

function withControlInput(): WorkflowGraph {
  const graph = createBlankGraph()
  const control = createNodeByKind('control-input', { x: 80, y: 520 })
  return appendNode(graph, control)
}

describe('portKey', () => {
  it('把节点与端口拼成唯一的端口键', () => {
    expect(portKey('input', 'out')).toBe('input:out')
  })
})

describe('primarySourcePort', () => {
  it('输入 / 控制输入 / 逻辑模型选择都继续走 out', () => {
    const graph = withControlInput()
    expect(primarySourcePort(nodeById(graph, 'input'))).toBe('out')
    expect(primarySourcePort(nodeById(graph, 'model'))).toBe('out')
    expect(primarySourcePort(controlInputOf(graph))).toBe('out')
  })

  it('协议发现默认接兜底分支，条件节点默认接第一条 IF 分支', () => {
    const graph = createBlankGraph()
    expect(primarySourcePort(nodeById(graph, 'protocol'))).toBe('unknown')
    expect(primarySourcePort(conditionOf(graph))).toBe(conditionOf(graph).cases[0].id)
  })

  it('出口节点没有可继续的端口', () => {
    expect(primarySourcePort(nodeById(createBlankGraph(), 'output'))).toBeNull()
  })
})

describe('resolveInsertAnchor', () => {
  it('可以从连线 id 解析出上游端口与原下游', () => {
    const anchor = resolveInsertAnchor(createBlankGraph(), { kind: 'condition', edgeId: 'edge-input-protocol' })
    expect(anchor).toEqual({ sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' })
  })

  it('连线不存在时返回 null', () => {
    expect(resolveInsertAnchor(createBlankGraph(), { kind: 'condition', edgeId: 'edge-missing' })).toBeNull()
  })

  it('可以从端口插入请求解析锚点，并带上端口当前的下游', () => {
    const anchor = resolveInsertAnchor(createBlankGraph(), { kind: 'model-select', prevNodeId: 'protocol', prevSourcePort: 'openai-completions' })
    expect(anchor).toEqual({ sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' })
  })

  it('端口上没有出边时下游为空', () => {
    const anchor = resolveInsertAnchor(createBlankGraph(), { kind: 'model-select', prevNodeId: 'condition', prevSourcePort: 'no-such-port' })
    expect(anchor).toEqual({ sourceNodeId: 'condition', sourcePort: 'no-such-port', targetNodeId: null })
  })

  it('上游节点不存在时返回 null', () => {
    expect(resolveInsertAnchor(createBlankGraph(), { kind: 'model-select', prevNodeId: 'nope', prevSourcePort: 'out' })).toBeNull()
  })
})

describe('insertNode', () => {
  it('在端口后面插入节点：原连线被替换为 上游 → 新节点 → 原下游', () => {
    const graph = createBlankGraph()
    const anchor = resolveInsertAnchor(graph, { kind: 'model-select', edgeId: 'edge-input-protocol' })
    expect(anchor).not.toBeNull()

    const inserted = createNodeByKind('model-select', { x: 240, y: 220 })
    const next = insertNode(graph, anchor!, inserted)

    expect(next.nodes).toHaveLength(graph.nodes.length + 1)
    expect(next.edges.some(edge => edge.id === 'edge-input-protocol')).toBe(false)
    expect(next.edges).toContainEqual({ id: `input:out->${inserted.id}`, sourceNodeId: 'input', sourcePort: 'out', targetNodeId: inserted.id })
    expect(next.edges).toContainEqual({ id: `${inserted.id}:out->protocol`, sourceNodeId: inserted.id, sourcePort: 'out', targetNodeId: 'protocol' })
    expectUniqueSourcePorts(next)
  })

  it('在末端端口插入时不会凭空接出下游', () => {
    const graph = appendNode(createBlankGraph(), createNodeByKind('condition', { x: 1800, y: 220 }))
    const tail = graph.nodes[graph.nodes.length - 1]
    const anchor = { sourceNodeId: 'output', sourcePort: 'out', targetNodeId: null }
    const inserted = createNodeByKind('model-select', { x: 2000, y: 220 })

    const next = insertNode(graph, anchor, inserted)
    expect(next.edges.filter(edge => edge.sourceNodeId === 'output')).toHaveLength(1)
    expect(next.edges.filter(edge => edge.sourceNodeId === inserted.id)).toHaveLength(0)
    expect(nodeById(next, tail.id)).toBeDefined()
    expectUniqueSourcePorts(next)
  })

  it('插入条件节点后，续接端口使用第一条 IF 分支', () => {
    const graph = createBlankGraph()
    const inserted = createNodeByKind('condition', { x: 240, y: 220 })
    const next = insertNode(graph, { sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' }, inserted)
    const condition = nodeById(next, inserted.id)
    if (condition.kind !== 'condition') throw new Error('condition 节点类型不匹配')

    expect(next.edges).toContainEqual({
      id: `${inserted.id}:${condition.cases[0].id}->protocol`,
      sourceNodeId: inserted.id,
      sourcePort: condition.cases[0].id,
      targetNodeId: 'protocol',
    })
  })
})

describe('appendNode', () => {
  it('只追加节点，不建立任何连线', () => {
    const graph = createBlankGraph()
    const next = appendNode(graph, createNodeByKind('model-select', { x: 0, y: 0 }))
    expect(next.nodes).toHaveLength(graph.nodes.length + 1)
    expect(next.edges).toEqual(graph.edges)
  })
})

describe('removeNode', () => {
  it('被删节点只有一条出边时，上游直接接下游（穿透删除）', () => {
    const graph = createBlankGraph()
    const next = removeNode(graph, 'model')

    expect(next.nodes.some(node => node.id === 'model')).toBe(false)
    expect(next.edges.some(edge => edge.sourceNodeId === 'model' || edge.targetNodeId === 'model')).toBe(false)
    expect(next.edges.filter(edge => edge.targetNodeId === 'output')).toHaveLength(3)
    expect(next.edges.find(edge => edge.sourceNodeId === 'condition' && edge.sourcePort === 'else')?.targetNodeId).toBe('output')
    expectUniqueSourcePorts(next)
  })

  it('被删节点有多条出边时，直接断开上游连线', () => {
    const graph = createBlankGraph()
    const next = removeNode(graph, 'condition')

    expect(next.nodes.some(node => node.id === 'condition')).toBe(false)
    expect(next.edges.some(edge => edge.targetNodeId === 'condition')).toBe(false)
    expect(next.edges).toHaveLength(graph.edges.length - 5)
    expectUniqueSourcePorts(next)
  })

  it('删除不存在的节点时图为空操作', () => {
    const graph = createBlankGraph()
    const next = removeNode(graph, 'not-exist')
    expect(next.nodes).toEqual(graph.nodes)
    expect(next.edges).toEqual(graph.edges)
  })
})

describe('cloneNode', () => {
  it('复制节点会换新 id 并偏移位置', () => {
    const graph = createBlankGraph()
    const source = nodeById(graph, 'model')
    const cloned = cloneNode(source)

    expect(cloned.id).not.toBe(source.id)
    expect(cloned.kind).toBe(source.kind)
    expect(cloned.position).toEqual({ x: source.position.x + 48, y: source.position.y + 48 })
  })

  it('条件分支与控制项都会重新生成 id', () => {
    const graph = withControlInput()
    const condition = cloneNode(conditionOf(graph))
    const control = cloneNode(controlInputOf(graph))

    if (condition.kind !== 'condition') throw new Error('condition 节点类型不匹配')
    if (control.kind !== 'control-input') throw new Error('control-input 节点类型不匹配')

    expect(condition.cases).toHaveLength(1)
    expect(condition.cases[0].id).not.toBe(conditionOf(graph).cases[0].id)
    expect(control.controls).toHaveLength(1)
    expect(control.controls[0].id).not.toBe(controlInputOf(graph).controls[0].id)
  })
})

describe('connectEdge', () => {
  it('新增连线时追加一条端口独占的出边', () => {
    const graph = createBlankGraph()
    const next = connectEdge(graph, 'condition', 'new-case', 'model')

    expect(next.edges.find(edge => edge.sourceNodeId === 'condition' && edge.sourcePort === 'new-case')?.targetNodeId).toBe('model')
    expectUniqueSourcePorts(next)
  })

  it('同一端口重复连接会改写目标而不是新增连线', () => {
    const graph = createBlankGraph()
    const next = connectEdge(graph, 'input', 'out', 'output')

    expect(next.edges.filter(edge => edge.sourceNodeId === 'input' && edge.sourcePort === 'out')).toHaveLength(1)
    expect(next.edges.find(edge => edge.sourceNodeId === 'input')?.targetNodeId).toBe('output')
    expectUniqueSourcePorts(next)
  })

  it('自连接与重复连接都返回原图引用', () => {
    const graph = createBlankGraph()
    expect(connectEdge(graph, 'input', 'out', 'input')).toBe(graph)
    expect(connectEdge(graph, 'input', 'out', 'protocol')).toBe(graph)
  })
})

describe('removeEdges', () => {
  it('按 id 删除连线', () => {
    const graph = createBlankGraph()
    const next = removeEdges(graph, ['edge-input-protocol', 'edge-model-output'])
    expect(next.edges).toHaveLength(graph.edges.length - 2)
    expect(next.edges.some(edge => edge.id === 'edge-input-protocol')).toBe(false)
    expect(next.nodes).toEqual(graph.nodes)
  })
})

describe('图谱校验（回归）', () => {
  it('空白脚手架图必须通过 schema 校验', () => {
    expect(WorkflowGraphSchema.safeParse(createBlankGraph()).error?.issues).toBeUndefined()
  })

  it('默认策略图由基础节点组合而成，同样必须通过 schema 校验', () => {
    const graph = createDefaultPolicyGraph(presetLogicalModels)
    expect(WorkflowGraphSchema.safeParse(graph).error?.issues).toBeUndefined()
    // 规则完全由既有基础节点表达，没有任何专用节点类型；
    // 多出来的 `note` 是画布便签，不参与执行（引擎遇到它直接跳过）。
    expect(new Set(graph.nodes.map(node => node.kind))).toEqual(new Set(['input', 'protocol-discovery', 'condition', 'model-select', 'output', 'note']))
    // 请求模型是协议层的事实：入口节点不解析请求体，所以链路里必须有一道协议发现，
    // 而且四条协议分支（含 `unknown`）都要进同一个条件 —— 认不出协议也要按同一套策略兜底。
    const protocol = graph.nodes.find(node => node.kind === 'protocol-discovery')
    expect(graph.edges.filter(edge => edge.sourceNodeId === protocol?.id).map(edge => edge.sourcePort).sort())
      .toEqual(['anthropic-messages', 'openai-completions', 'openai-responses', 'unknown'])
    expect(graph.edges.filter(edge => edge.sourceNodeId === protocol?.id).every(edge => edge.targetNodeId === 'condition')).toBe(true)
    expect(graph.edges.some(edge => edge.sourceNodeId === 'input' && edge.targetNodeId === protocol?.id)).toBe(true)
    // 命中判断是一条普通的「字段 in 字段」条件，不是引擎预计算的布尔字段；
    // 右侧用通配投影读逻辑模型 id，不需要再派生一份 id 数组。
    const condition = graph.nodes.find(node => node.kind === 'condition')
    expect(condition?.cases[0].conditions[0]).toMatchObject({
      fieldPath: 'request.body.model',
      operator: 'in',
      valueSource: 'field',
      valueFieldPath: 'logicalModels[*].modelId',
    })
  })

  it('UA 预设必须通过 schema 校验，且循环体靠回边闭合', () => {
    const graph = createUserAgentGraph(presetLogicalModels)
    expect(WorkflowGraphSchema.safeParse(graph).error?.issues).toBeUndefined()

    const iteration = graph.nodes.find(node => node.kind === 'iteration')
    expect(iteration).toBeDefined()
    // 遍历头值而不是某个固定头名，头名大小写与由谁携带都不影响判定。
    expect(iteration?.sourcePath).toBe('request.headers')
    // resultPath 留空：命中判定与循环体写落点共用 collectPath，没命中时汇总结果不能盖掉它。
    expect(iteration?.resultPath).toBe('')
    expect(iteration?.collectPath).toBe('route.modelIds')

    // body 端口进循环体，循环体末端连回迭代节点自身表示「本轮结束」。
    const bodyEdge = graph.edges.find(edge => edge.sourceNodeId === iteration?.id && edge.sourcePort === 'body')
    expect(bodyEdge?.targetNodeId).toBe('ua-condition')
    const backEdges = graph.edges
      .filter(edge => edge.targetNodeId === iteration?.id && edge.sourceNodeId !== 'input')
      .map(edge => edge.sourceNodeId)
    expect(backEdges.sort()).toEqual(['model-claude-cli', 'model-cursor', 'ua-condition'])
    // 从 body 端口往回走能回到本节点，说明循环是闭合的。
    expect(graph.edges.some(edge => edge.sourceNodeId === 'model-cursor' && edge.targetNodeId === iteration?.id)).toBe(true)
  })

  it('插入任意可新增节点后，图仍能通过 schema 校验', () => {
    for (const kind of APPENDABLE_KINDS) {
      const graph = createBlankGraph()
      const anchor = resolveInsertAnchor(graph, { kind, edgeId: 'edge-input-protocol' })
      expect(anchor).not.toBeNull()

      const next = insertNode(graph, anchor!, createNodeByKind(kind, { x: 240, y: 220 }))
      // 一旦校验失败，缓存就会被丢弃、用户的改动会整张丢失，所以这里必须为空。
      expect({ kind, issues: WorkflowGraphSchema.safeParse(next).error?.issues }).toEqual({ kind, issues: undefined })
    }
  })

  it('每个预设都能通过 schema 校验，且预设注册表保持「唯一 id + 第一个是默认策略」', () => {
    // 预设是用户第一次打开路由页时看到的样板，坏掉一个就等于入口不可用。
    const ids = ROUTER_POLICY_PRESETS.map(preset => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ROUTER_POLICY_PRESETS[0].isDefault).toBe(true)
    expect(ROUTER_POLICY_PRESETS.filter(preset => preset.isDefault)).toHaveLength(1)

    for (const preset of ROUTER_POLICY_PRESETS) {
      const graph = preset.createGraph(presetLogicalModels)
      expect({ id: preset.id, issues: WorkflowGraphSchema.safeParse(graph).error?.issues }).toEqual({ id: preset.id, issues: undefined })
      // 工厂必须每次返回全新对象，否则套用预设会污染上一个图。
      expect(preset.createGraph(presetLogicalModels)).not.toBe(preset.createGraph(presetLogicalModels))
      expect(findPolicyPreset(preset.id)?.id).toBe(preset.id)
    }
    expect(findPolicyPreset('not-a-preset')).toBeUndefined()
  })

  it('每个预设的落点 id 都是传入列表里的真实逻辑模型，不会留下写死的占位值', () => {
    // 「套用即能用」的核心判据：预设里出现的每个模型 id 都必须存在，否则一跑就报没有可用逻辑模型。
    const knownIds = new Set(presetLogicalModels.map(model => model.modelId))

    for (const preset of ROUTER_POLICY_PRESETS) {
      const graph = preset.createGraph(presetLogicalModels)
      const modelIds = graph.nodes.flatMap(node => {
        if (node.kind !== 'model-select') return []
        return [...node.modelIds, ...node.fallbackModelIds]
      })
      // 至少有一个落点，否则出口节点只会报「没有可用逻辑模型」。
      expect({ id: preset.id, modelIds }).toEqual({ id: preset.id, modelIds: expect.arrayContaining([expect.any(String)]) })
      for (const modelId of modelIds) expect({ id: preset.id, knownIds: knownIds.has(modelId) }).toEqual({ id: preset.id, knownIds: true })
    }

    // LLM 预设的判定节点也要拿到真实模型，否则提示词节点一上来就是失败的。
    const prompt = createLlmComplexityGraph(presetLogicalModels).nodes.find(node => node.kind === 'prompt')
    expect(prompt?.kind === 'prompt' && knownIds.has(prompt.logicalModelId)).toBe(true)
  })

  it('一个已启用逻辑模型都没有时，预设不会留下写死的落点', () => {
    // 空列表是过渡态（用户还没配逻辑模型），此时宁可没有落点，也不要编一个不存在的 id。
    for (const preset of ROUTER_POLICY_PRESETS) {
      const graph = preset.createGraph([])
      expect(WorkflowGraphSchema.safeParse(graph).error?.issues).toBeUndefined()
      const modelIds = graph.nodes.flatMap(node => (node.kind === 'model-select' ? [...node.modelIds, ...node.fallbackModelIds] : []))
      expect({ id: preset.id, modelIds }).toEqual({ id: preset.id, modelIds: [] })
    }
  })
})

describe('预设落点解析', () => {
  it('兜底落点取内建默认逻辑模型，其余逻辑模型留给分流', () => {
    const pool = createPresetModelPool([
      { modelId: 'model-fast', enabled: true },
      { modelId: 'default', enabled: true },
      { modelId: 'model-smart', enabled: true },
    ])
    expect(pool.fallbackModelId).toBe('default')
    // 兜底落点要从分流候选里排除，否则两个分支会撞到同一个逻辑模型。
    expect(pool.landingModelIds).toEqual(['model-fast', 'model-smart'])
  })

  it('内建默认逻辑模型按 modelId 精确匹配，相近的名字不算', () => {
    expect(createPresetModelPool([{ modelId: 'default', enabled: true }]).fallbackModelId).toBe('default')
    // `model-default` 只是「名字里带 default」，不是内建默认本身，只能按列表顺序当兜底。
    expect(createPresetModelPool([{ modelId: 'model-default', enabled: true }]).fallbackModelId).toBe('model-default')
  })

  it('停用的逻辑模型不参与落点', () => {
    const pool = createPresetModelPool([
      { modelId: 'default', enabled: true },
      { modelId: 'model-off', enabled: false },
    ])
    expect(pool.landingModelIds).toEqual([])
  })

  it('内建默认逻辑模型不可用时退回第一个已启用模型', () => {
    // 生成预设是「帮你先把图填上」，前面有真模型就不留空落点；运行时遇到同样情况则是直接拒绝。
    expect(createPresetModelPool([{ modelId: 'model-fast', enabled: true }]).fallbackModelId).toBe('model-fast')
  })

  it('一个逻辑模型都没有时兜底为空，落点解析出空数组', () => {
    const pool = createPresetModelPool([])
    expect(pool).toEqual({ fallbackModelId: null, landingModelIds: [] })
    expect(resolveLandingModelIds(pool, null)).toEqual([])
    expect(resolveLandingModelIds(pool, 0)).toEqual([])
  })

  it('分流候选不够时退回兜底落点，不留死落点', () => {
    const pool = createPresetModelPool([
      { modelId: 'default', enabled: true },
      { modelId: 'model-fast', enabled: true },
    ])
    expect(resolveLandingModelIds(pool, null)).toEqual(['default'])
    expect(resolveLandingModelIds(pool, 0)).toEqual(['model-fast'])
    // 只有一个分流候选，第二条分支没有自己的落点，只能和兜底落点重合。
    expect(resolveLandingModelIds(pool, 1)).toEqual(['default'])
    expect(resolveLandingModelIds(pool, 99)).toEqual(['default'])
  })
})

describe('图操作与引擎的协同', () => {
  it('在连线上插入节点后仍通过图校验，且引擎按新顺序经过它', async () => {
    const graph = createBlankGraph()
    const anchor = resolveInsertAnchor(graph, { kind: 'protocol-discovery', edgeId: 'edge-input-protocol' })
    expect(anchor).not.toBeNull()

    const inserted = createNodeByKind('protocol-discovery', { x: 240, y: 220 })
    const next = insertNode(graph, anchor!, inserted)

    expect(WorkflowGraphSchema.safeParse(next).error?.issues).toBeUndefined()

    const result = await runWorkflow(next, { request: { body: {} }, metadata: {} })
    const visited = result.trace.map(step => step.nodeId)

    expect(visited).toContain(inserted.id)
    expect(visited.indexOf('input')).toBeLessThan(visited.indexOf(inserted.id))
    expect(visited.indexOf(inserted.id)).toBeLessThan(visited.indexOf('protocol'))
  })

  it('穿透删除中间节点后，引擎把上游直接接到下游', async () => {
    const next = removeNode(createBlankGraph(), 'model')
    const result = await runWorkflow(next, { request: { body: {} }, metadata: {} })

    expect(result.stopReason).toBe('output')
    expect(result.trace.some(step => step.nodeId === 'model')).toBe(false)
    expect(result.trace[result.trace.length - 1].nodeId).toBe('output')
  })
})
