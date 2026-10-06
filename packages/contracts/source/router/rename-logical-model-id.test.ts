import { describe, expect, it } from 'vitest'
import type { RouteRule, RouteRuleCondition, RouteRuleSet } from './route-rules'
import { renameLogicalModelIdInGraph, renameLogicalModelIdInRuleSet } from './rename-logical-model-id'
import type { ConditionNode, ModelSelectNode, ScriptNode, WorkflowGraph, WorkflowNodeModel } from './types'

/**
 * 逻辑模型改名的连带改写。
 *
 * 只有两处引用会写死 id：**结构化引用**（节点/落点上的 id 列表）与**字面量条件**
 * （`valueSource !== 'field'` 且 `value` 恰好等于旧 id）。其余一律不动——
 * 字段比较条件比的是运行时列表，id 改了自然跟上；脚本里的字符串是任意 JS，猜错比不改更糟。
 *
 * 另一半约定同样重要：**没改就返回同一个对象**（引用相等）。调用方靠它决定要不要写库。
 */

function base(overrides: Partial<WorkflowNodeModel> = {}): WorkflowNodeModel {
  return {
    id: 'node_1',
    kind: 'input',
    name: '入口',
    enabled: true,
    description: '',
    position: { x: 0, y: 0 },
    ...overrides,
  } as WorkflowNodeModel
}

function modelSelect(overrides: Partial<ModelSelectNode> = {}): ModelSelectNode {
  return {
    ...base({ kind: 'model-select' }),
    kind: 'model-select',
    source: 'fixed',
    variablePath: 'request.body.model',
    modelIds: ['lm_old'],
    fallbackModelIds: ['lm_old', 'lm_keep'],
    ...overrides,
  } as ModelSelectNode
}

/*
 * 条件规则用**表里落地的那份**（`RouteRuleCondition`）而不是手写的那张宽松脸：
 * 这份 fixture 同时要往工作流图（`ConditionRule`，两个字段可缺省）与规则表里塞，
 * 落到规则表时 `valueSource` / `valueFieldPath` 是必填的。直接给足值，两边都成立。
 */
function conditionRule(overrides: Partial<RouteRuleCondition> = {}): RouteRuleCondition {
  return {
    fieldPath: 'request.body.model',
    valueType: 'string',
    operator: 'equals',
    valueSource: 'literal',
    valueFieldPath: '',
    value: 'lm_old',
    ...overrides,
  }
}

function conditionNode(cases: ConditionNode['cases']): ConditionNode {
  return { ...base({ kind: 'condition' }), kind: 'condition', cases } as ConditionNode
}

function scriptNode(): ScriptNode {
  return {
    ...base({ kind: 'script' }),
    kind: 'script',
    // 脚本是任意 JS：里面的 'lm_old' 是字符串常量，不是可判定的 id 引用。
    code: 'return { model: "lm_old" }',
    resultPath: 'route.scriptResult',
    timeoutMilliseconds: 1_000,
  } as ScriptNode
}

function graph(nodes: WorkflowNodeModel[]): WorkflowGraph {
  return { version: 1, nodes, edges: [] }
}

function ruleSet(overrides: Partial<RouteRuleSet> = {}): RouteRuleSet {
  return {
    version: 1,
    rules: [],
    fallbackModelIds: ['lm_old'],
    ...overrides,
  }
}

function rule(overrides: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 'rule_1',
    name: '规则',
    enabled: true,
    logicalOperator: 'and',
    conditions: [conditionRule()],
    landing: { source: 'fixed', logicalModelIds: ['lm_old'], variablePath: 'request.body.model' },
    ...overrides,
  }
}

describe('renameLogicalModelIdInGraph', () => {
  it('逻辑模型选择节点的固定列表与兜底列表一起改', () => {
    const next = renameLogicalModelIdInGraph(graph([modelSelect()]), 'lm_old', 'lm_new')
    const node = next.nodes[0] as ModelSelectNode

    expect(node.modelIds).toEqual(['lm_new'])
    expect(node.fallbackModelIds).toEqual(['lm_new', 'lm_keep'])
  })

  it('字面量条件改，字段比较条件不动', () => {
    const next = renameLogicalModelIdInGraph(graph([
      conditionNode([
        { id: 'case_1', name: '字面量', logicalOperator: 'and', conditions: [conditionRule()] },
        {
          id: 'case_2',
          name: '字段比较',
          logicalOperator: 'and',
          conditions: [conditionRule({ valueSource: 'field', valueFieldPath: 'logicalModels[*].modelId', value: undefined })],
        },
      ]),
    ]), 'lm_old', 'lm_new')
    const node = next.nodes[0] as ConditionNode

    expect(node.cases[0].conditions[0].value).toBe('lm_new')
    // 比的是运行时列表 `logicalModels[*].modelId`，改名后它自然跟上，不需要写死新 id。
    expect(node.cases[1].conditions[0]).toMatchObject({
      valueSource: 'field',
      valueFieldPath: 'logicalModels[*].modelId',
    })
    expect(node.cases[1].conditions[0].value).toBeUndefined()
  })

  it('只有一部分条件命中时，命中的改、没命中的保持同一个对象', () => {
    const untouched = conditionRule({ value: 'lm_other' })
    const next = renameLogicalModelIdInGraph(graph([
      conditionNode([{ id: 'case_1', name: 'c', logicalOperator: 'and', conditions: [conditionRule(), untouched] }]),
    ]), 'lm_old', 'lm_new')
    const node = next.nodes[0] as ConditionNode

    expect(node.cases[0].conditions[0].value).toBe('lm_new')
    expect(node.cases[0].conditions[1]).toBe(untouched)
  })

  it('脚本节点里的字符串不改（那是任意 JS，不求出值就判不出哪个是 id）', () => {
    const node = scriptNode()
    const original = graph([node])

    const next = renameLogicalModelIdInGraph(original, 'lm_old', 'lm_new')

    expect(next).toBe(original)
    expect((next.nodes[0] as ScriptNode).code).toBe('return { model: "lm_old" }')
  })

  it('没有任何引用时原样返回同一个图（调用方据此跳过写库）', () => {
    const original = graph([base({ kind: 'input' }), conditionNode([
      { id: 'case_1', name: 'c', logicalOperator: 'and', conditions: [conditionRule({ value: 'lm_other' })] },
    ])])

    expect(renameLogicalModelIdInGraph(original, 'lm_old', 'lm_new')).toBe(original)
  })

  it('空图原样返回', () => {
    const original = graph([])
    expect(renameLogicalModelIdInGraph(original, 'lm_old', 'lm_new')).toBe(original)
  })

  it('改了才产生新图，未改动的节点保持同一个对象', () => {
    const untouched = base({ id: 'node_input', kind: 'input' })
    const original = graph([untouched, modelSelect()])
    const next = renameLogicalModelIdInGraph(original, 'lm_old', 'lm_new')

    expect(next).not.toBe(original)
    expect(next.nodes[0]).toBe(untouched)
    expect(next.edges).toBe(original.edges)
  })
})

describe('renameLogicalModelIdInRuleSet', () => {
  it('表级兜底落点、规则落点、字面量条件一起改', () => {
    const next = renameLogicalModelIdInRuleSet(ruleSet({ rules: [rule()] }), 'lm_old', 'lm_new')

    expect(next.fallbackModelIds).toEqual(['lm_new'])
    expect(next.rules[0].landing.logicalModelIds).toEqual(['lm_new'])
    expect(next.rules[0].conditions[0].value).toBe('lm_new')
  })

  it('字段比较条件不动', () => {
    const next = renameLogicalModelIdInRuleSet(ruleSet({
      rules: [rule({ conditions: [conditionRule({ valueSource: 'field', valueFieldPath: 'logicalModels[*].modelId', value: undefined })] })],
    }), 'lm_old', 'lm_new')

    expect(next.rules[0].conditions[0].valueSource).toBe('field')
    expect(next.rules[0].conditions[0].value).toBeUndefined()
  })

  it('没有任何引用时原样返回同一张表', () => {
    const original = ruleSet({ fallbackModelIds: ['lm_keep'], rules: [rule({ conditions: [conditionRule({ value: 'lm_other' })], landing: { source: 'variable', logicalModelIds: [], variablePath: 'request.body.model' } })] })

    expect(renameLogicalModelIdInRuleSet(original, 'lm_old', 'lm_new')).toBe(original)
  })

  it('只改命中规则的落点，其它规则保持同一个对象', () => {
    const untouched = rule({ id: 'rule_2', conditions: [conditionRule({ value: 'lm_other' })], landing: { source: 'fixed', logicalModelIds: ['lm_other'], variablePath: 'request.body.model' } })
    const original = ruleSet({ fallbackModelIds: ['lm_keep'], rules: [rule(), untouched] })
    const next = renameLogicalModelIdInRuleSet(original, 'lm_old', 'lm_new')

    expect(next).not.toBe(original)
    expect(next.rules[1]).toBe(untouched)
    // 表级兜底没命中 → 数组本身保持同一引用。
    expect(next.fallbackModelIds).toBe(original.fallbackModelIds)
  })

  it('空规则表原样返回', () => {
    const original = ruleSet({ fallbackModelIds: [], rules: [] })
    expect(renameLogicalModelIdInRuleSet(original, 'lm_old', 'lm_new')).toBe(original)
  })
})
