import { describe, expect, it } from 'vitest'
import { createBlankGraph, createNodeByKind, createInputNode, createOutputNode, createConditionRule, ROUTER_POLICY_PRESETS } from './presets'
import { RouteContextInputSchema, WorkflowGraphSchema, WorkflowNodeModelSchema } from './schemas'
import {
  ALL_CONDITION_OPERATORS,
  ALL_WORKFLOW_PROTOCOLS,
  PROMPT_TIMEOUT_DEFAULT,
  PROMPT_TIMEOUT_LIMIT,
  SCRIPT_TIMEOUT_DEFAULT,
  SCRIPT_TIMEOUT_LIMIT,
  type AppendableKind,
  type ConditionOperator,
  type WorkflowNodeKind,
} from './types'

/**
 * 配置契约（types ↔ schemas ↔ presets 三处锁步）。
 *
 * 引擎只认 `types.ts` 的类型，画布与数据库只认 `schemas.ts` 的 zod：
 * 两边漂移的表现是「界面上能建的节点，引擎不认」或者「引擎支持的取值，保存不了」。
 * 这一组用例专门盯这些**跨文件的清单**，不测运行语义（那在 `engine-nodes.test.ts`）。
 */

/**
 * 节点类型全集。写成 `Record<WorkflowNodeKind, true>` 是为了拿到编译期穷尽检查：
 * 往 `WorkflowNodeKind` 里加一个成员而忘了同步 zod 时，这张表先报错，
 * 下面的「每类节点都能过校验」用例随即失败。
 */
const nodeKinds: Record<WorkflowNodeKind, true> = {
  input: true,
  'control-input': true,
  'protocol-discovery': true,
  condition: true,
  'model-select': true,
  iteration: true,
  script: true,
  prompt: true,
  note: true,
  output: true,
}

const appendableKinds: AppendableKind[] = ['control-input', 'protocol-discovery', 'condition', 'model-select', 'iteration', 'script', 'prompt', 'note']

function nodeOfKind(kind: WorkflowNodeKind) {
  if (kind === 'input') return createInputNode({ x: 0, y: 0 })
  if (kind === 'output') return createOutputNode({ x: 0, y: 0 })
  return createNodeByKind(kind, { x: 0, y: 0 })
}

function ruleOf(operator: ConditionOperator) {
  return { ...createConditionRule(), operator }
}

function conditionNodeWith(rule: ReturnType<typeof ruleOf>) {
  const node = createNodeByKind('condition', { x: 0, y: 0 })
  if (node.kind !== 'condition') throw new Error('expected condition node')
  return { ...node, cases: [{ ...node.cases[0], conditions: [rule] }] }
}

describe('配置契约 · 节点类型清单', () => {
  it.each(Object.keys(nodeKinds) as WorkflowNodeKind[])('类型 %s 在 zod 里是同一种认识', (kind) => {
    const parsed = WorkflowNodeModelSchema.safeParse(nodeOfKind(kind))

    expect(parsed.error?.issues).toBeUndefined()
    expect((parsed.data as { kind: string } | undefined)?.kind).toBe(kind)
  })

  it('未知的节点类型被拒（新增类型必须同时落进 zod 的 kind 枚举）', () => {
    const ghost = { ...createInputNode({ x: 0, y: 0 }), kind: 'ghost-node' }

    expect(WorkflowNodeModelSchema.safeParse(ghost).success).toBe(false)
  })
})

describe('配置契约 · 新建节点的默认值', () => {
  it.each([...appendableKinds, 'input', 'output'] as WorkflowNodeKind[])('新建的 %s 节点不带隐藏字段、也不需要补默认值', (kind) => {
    const node = nodeOfKind(kind)

    // zod 会剥掉未知字段、也不会补任何缺省项：往返必须完全相等。
    // 一旦工厂多写一个 zod 不认识的字段（保存后静默丢失），或漏写一个必填字段（校验失败丢整张图），这里就红。
    expect(WorkflowNodeModelSchema.parse(node)).toEqual(node)
  })

  it('可新增节点的类型集合与渲染层给用户的选择一致', () => {
    // 输入 / 输出是固定节点，不允许新增：工厂里也不该给出它们的追加版本。
    expect(appendableKinds).not.toContain('input')
    expect(appendableKinds).not.toContain('output')
    for (const kind of appendableKinds) expect(Object.keys(nodeKinds)).toContain(kind)
  })
})

describe('配置契约 · 条件规则', () => {
  it.each(ALL_CONDITION_OPERATORS)('操作符 %s 引擎认识、zod 也收得下', (operator) => {
    expect(WorkflowNodeModelSchema.safeParse(conditionNodeWith(ruleOf(operator))).error?.issues).toBeUndefined()
  })

  it('未知操作符被拒，不会静默退化成「永远不命中」', () => {
    const ghost = { ...ruleOf('equals'), operator: 'not-an-operator' }

    expect(WorkflowNodeModelSchema.safeParse(conditionNodeWith(ghost as never)).success).toBe(false)
  })

  it('省略 valueSource 时补成字面量比较，字段操作数默认留空', () => {
    const node = conditionNodeWith({ ...createConditionRule(), valueSource: undefined as never, valueFieldPath: undefined as never })
    const parsed = WorkflowNodeModelSchema.parse(node)

    expect(parsed.kind).toBe('condition')
    if (parsed.kind !== 'condition') return
    expect(parsed.cases[0]?.conditions[0]).toMatchObject({ valueSource: 'literal', valueFieldPath: '' })
  })

  it('分支必须至少有一条条件，空分支被拒', () => {
    const node = createNodeByKind('condition', { x: 0, y: 0 })
    if (node.kind !== 'condition') throw new Error('expected condition node')
    const empty = { ...node, cases: [{ ...node.cases[0], conditions: [] }] }

    expect(WorkflowNodeModelSchema.safeParse(empty).success).toBe(false)
  })
})

describe('配置契约 · 可省字段的缺省值', () => {
  const base = { id: 'node', kind: 'model-select', name: '节点', enabled: true, description: '', position: { x: 0, y: 0 } }

  it('省略逻辑模型选择节点的全部配置项时补齐成「固定来源 + 未选择」', () => {
    expect(WorkflowNodeModelSchema.parse(base)).toMatchObject({ source: 'fixed', variablePath: '', modelIds: [], fallbackModelIds: [] })
  })

  it('省略遍历节点的配置项时补齐成建模默认值', () => {
    expect(WorkflowNodeModelSchema.parse({ ...base, kind: 'iteration' })).toMatchObject({
      sourcePath: '',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
    })
  })

  it('省略脚本节点的配置项时补齐成与常量一致的超时', () => {
    expect(WorkflowNodeModelSchema.parse({ ...base, kind: 'script' })).toMatchObject({ code: '', resultPath: 'route.scriptResult', timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT })
  })

  it('省略 LLM 节点的配置项时补齐成与常量一致的超时与采样参数', () => {
    expect(WorkflowNodeModelSchema.parse({ ...base, kind: 'prompt' })).toMatchObject({
      logicalModelId: '',
      systemPrompt: '',
      promptTemplate: '',
      resultPath: 'route.promptResult',
      temperature: 0.7,
      maxTokens: 1_024,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    })
  })

  it('新建节点的默认配置已经填到「拖进来就能跑」的程度，不给用户留空壳', () => {
    const iteration = createNodeByKind('iteration', { x: 0, y: 0 })
    // 缺省值（''、[]）只是旧数据的兜底；新建节点必须直接指向真实存在的路径。
    expect(iteration).toMatchObject({ sourcePath: 'logicalModels', collectPath: 'route.modelIds', collectMode: 'first', resultPath: 'route.modelIds' })

    const script = createNodeByKind('script', { x: 0, y: 0 })
    if (script.kind !== 'script') throw new Error('expected script node')
    expect(script.code).toContain("get('logicalModels[*].modelId')")
    expect(script.resultPath).toBe('route.scriptResult')

    const condition = createNodeByKind('condition', { x: 0, y: 0 })
    if (condition.kind !== 'condition') throw new Error('expected condition node')
    // 默认条件读请求行 —— 输入节点保证得了的事实，而不是它看不见的请求体。
    expect(condition.cases[0]?.conditions[0]).toMatchObject({ fieldPath: 'request.method', operator: 'equals', valueSource: 'literal', value: 'POST' })

    const controlInput = createNodeByKind('control-input', { x: 0, y: 0 })
    if (controlInput.kind !== 'control-input') throw new Error('expected control-input node')
    expect(controlInput.controls).toHaveLength(1)
    expect(controlInput.controls[0]).toMatchObject({ enabled: true, kind: 'switch' })

    const prompt = createNodeByKind('prompt', { x: 0, y: 0 })
    if (prompt.kind !== 'prompt') throw new Error('expected prompt node')
    expect(prompt.promptTemplate).toContain('${logicalModels[*].modelId}')
    // 逻辑模型必须由用户显式选一个：引擎不接受「猜一个上游来执行」。
    expect(prompt.logicalModelId).toBe('')
  })
})

describe('配置契约 · 取值边界', () => {
  const base = { id: 'node', name: '节点', enabled: true, description: '', position: { x: 0, y: 0 } }

  it('脚本超时不能超过上限（否则沙箱里的死循环会把请求拖死）', () => {
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'script', timeoutMilliseconds: SCRIPT_TIMEOUT_LIMIT }).success).toBe(true)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'script', timeoutMilliseconds: SCRIPT_TIMEOUT_LIMIT + 1 }).success).toBe(false)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'script', timeoutMilliseconds: 0 }).success).toBe(false)
  })

  it('LLM 超时、采样温度与输出上限都卡在各自的区间内', () => {
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'prompt', timeoutMilliseconds: PROMPT_TIMEOUT_LIMIT }).success).toBe(true)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'prompt', timeoutMilliseconds: PROMPT_TIMEOUT_LIMIT + 1 }).success).toBe(false)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'prompt', temperature: 2 }).success).toBe(true)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'prompt', temperature: 2.5 }).success).toBe(false)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'prompt', maxTokens: 32_768 }).success).toBe(true)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'prompt', maxTokens: 32_769 }).success).toBe(false)
  })

  it('迭代轮数必须是正整数', () => {
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'iteration', maxIterations: 1 }).success).toBe(true)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'iteration', maxIterations: 0 }).success).toBe(false)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'iteration', maxIterations: 2.5 }).success).toBe(false)
  })

  it('落点 id 不接受空串（空落点只能由「数组为空」表达，不能由「里面塞个空串」表达）', () => {
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'model-select', modelIds: [''] }).success).toBe(false)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'model-select', modelIds: [] }).success).toBe(true)
  })

  it('出口节点的落点开关与汇总级别没有默认值，必须显式写入', () => {
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'output' }).success).toBe(false)
    expect(WorkflowNodeModelSchema.safeParse({ ...base, kind: 'output', includeTrace: true, summaryLevel: 'detailed' }).success).toBe(true)
  })
})

describe('配置契约 · 请求上下文与图', () => {
  it.each(ALL_WORKFLOW_PROTOCOLS)('协议 %s 可以作为调用方结论传进来', (protocol) => {
    expect(RouteContextInputSchema.safeParse({ request: {}, protocol }).error?.issues).toBeUndefined()
  })

  it('未知协议被拒：调用方结论必须是引擎认识的四种之一', () => {
    expect(RouteContextInputSchema.safeParse({ request: {}, protocol: 'openai-embeddings' }).success).toBe(false)
  })

  it('图的版本号只能是 1（读到别的版本说明数据不是这一版写的）', () => {
    const graph = createBlankGraph()

    expect(WorkflowGraphSchema.safeParse({ ...graph, version: 2 }).success).toBe(false)
    expect(WorkflowGraphSchema.safeParse(graph).error?.issues).toBeUndefined()
  })

  it('连线的 id / 两端节点 / 端口都不能是空串', () => {
    const graph = createBlankGraph()

    expect(WorkflowGraphSchema.safeParse({ ...graph, edges: [{ id: '', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' }] }).success).toBe(false)
    expect(WorkflowGraphSchema.safeParse({ ...graph, edges: [{ id: 'edge', sourceNodeId: 'input', sourcePort: '', targetNodeId: 'protocol' }] }).success).toBe(false)
  })

  it('四个预设生成的图都满足同一份 schema（界面看到的与运行时生效的是同一张）', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      const graph = preset.createGraph([{ modelId: 'default', enabled: true }])

      expect({ id: preset.id, issues: WorkflowGraphSchema.safeParse(graph).error?.issues }).toEqual({ id: preset.id, issues: undefined })
    }
  })
})
