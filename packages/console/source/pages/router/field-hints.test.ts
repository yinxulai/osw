import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { createBlankGraph, ROUTER_POLICY_PRESETS } from '@common/router/presets'
import { requestShapeOf } from '@common/router/request-shape'
import { resolveInputHints } from './field-hints'
import { FIELD_READ_KINDS, readCandidates, type FieldReadKind } from './panel/field-candidates'
import { ALL_WORKFLOW_PROTOCOLS, type RuntimeLogicalModel, type WorkflowGraph, type WorkflowNodeModel, type WorkflowProtocol } from '@common/router/types'

const t = createAppTranslator('zh-CN')
const position = { x: 0, y: 0 }
const edge = (sourceNodeId: string, sourcePort: string, targetNodeId: string) => ({ id: `${sourceNodeId}:${sourcePort}->${targetNodeId}`, sourceNodeId, sourcePort, targetNodeId })
const graph = (nodes: WorkflowNodeModel[], edges: WorkflowGraph['edges']): WorkflowGraph => ({ version: 1, nodes, edges })
const input = (id = 'input'): WorkflowNodeModel => ({ id, kind: 'input', name: id, enabled: true, description: '', position })
const output = (): WorkflowNodeModel => ({ id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position, includeTrace: true, summaryLevel: 'brief' })
const condition = (id: string): WorkflowNodeModel => ({ id, kind: 'condition', name: id, enabled: true, description: '', position, cases: [{ id: 'case-1', name: '分支 1', logicalOperator: 'and', conditions: [{ fieldPath: 'request.body.model', valueType: 'string', operator: 'equals' }] }] })
const protocol = (id: string): WorkflowNodeModel => ({ id, kind: 'protocol-discovery', name: id, enabled: true, description: '', position })
const control = (id: string): WorkflowNodeModel => ({ id, kind: 'control-input', name: id, enabled: true, description: '', position, controls: [{ id: `${id}-mode`, key: 'mode', label: '模式', kind: 'select', enabled: true, defaultValue: 'fast', options: [{ label: 'Fast', value: 'fast' }, { label: 'Safe', value: 'safe' }] }] })

describe('resolveInputHints', () => {
  it('仅提供真实上游字段并沿多级连接传递', () => {
    const target = condition('target')
    const hints = resolveInputHints(t, graph([input(), control('control'), protocol('protocol'), target, output()], [edge('input', 'out', 'control'), edge('control', 'out', 'protocol'), edge('protocol', 'openai-completions', 'target')]), target.id)
    expect(hints.fields.map(field => field.path)).toEqual(expect.arrayContaining(['request.body.model', 'route.controls.mode', 'route.protocol']))
    expect(hints.fields.find(field => field.path === 'route.controls.mode')).toMatchObject({ valueType: 'enum', enumOptions: ['fast', 'safe'] })
    // 请求模型是协议层的事实：它由协议发现节点（按命中的协议）给出，而不是输入节点。
    expect(hints.fields.find(field => field.path === 'request.body.model')).toMatchObject({ valueType: 'string', sourceNodeId: 'protocol', sourcePort: 'openai-completions' })
  })
  it('按协议分支收窄枚举并忽略孤立节点', () => {
    const target = condition('target')
    const hints = resolveInputHints(t, graph([input(), protocol('protocol'), target, control('isolated'), output()], [edge('input', 'out', 'protocol'), edge('protocol', 'unknown', 'target')]), target.id)
    const paths = hints.fields.map(field => field.path)
    expect(hints.fields.find(field => field.path === 'route.protocol')?.enumOptions).toEqual(['unknown'])
    // 只有一根轴：枚举 = 引擎承认的取值集合，因此包含这一版还没接上的 `websocket`。
    // 这里少一个值就等于让用户写不出合法的判断。
    expect(hints.fields.find(field => field.path === 'route.transport')?.enumOptions).toEqual(['http', 'http-stream', 'websocket'])
    expect(paths).not.toContain('route.controls.mode')
    // 认不出协议时一个请求体字段都保证不了：只留输入节点的请求体整体。
    expect(paths).toContain('request.body')
    expect(paths).not.toContain('request.body.model')
  })
  it('循环图不会无限遍历且禁用节点不产生字段', () => {
    const target = condition('target')
    const disabled = control('control'); disabled.enabled = false
    const hints = resolveInputHints(t, graph([input(), disabled, target, output()], [edge('input', 'out', 'control'), edge('control', 'out', 'target'), edge('target', 'else', 'control')]), target.id)
    expect(hints.upstreamNodeIds).toEqual(expect.arrayContaining(['input', 'control']))
    expect(hints.upstreamNodeIds).not.toContain('target')
    expect(hints.fields.map(field => field.path)).not.toContain('route.controls.mode')
  })
  it('声明逻辑模型选择节点的落点逻辑模型字段', () => {
    const target = condition('target')
    const modelSelect: WorkflowNodeModel = { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position, source: 'fixed', variablePath: '', modelIds: ['model-a', 'model-b'], fallbackModelIds: [] }
    const hints = resolveInputHints(t, graph([input(), modelSelect, target, output()], [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'target')]), target.id)
    expect(hints.fields.map(field => field.path)).toContain('route.modelIds')
    expect(hints.fields.map(field => field.path)).toContain('route.fallback')
    expect(hints.fields.map(field => field.path)).not.toContain('metadata.iteration.current')
    expect(hints.fields.map(field => field.path)).not.toContain('metadata.loop.index')
  })

  it('提供路由决策依据字段用于通用条件判断', () => {
    const target = condition('target')
    const hints = resolveInputHints(
      t,
      graph([input(), protocol('protocol'), target, output()], [edge('input', 'out', 'protocol'), edge('protocol', 'openai-completions', 'target')]),
      target.id,
    )

    const paths = hints.fields.map(field => field.path)
    expect(paths).toEqual(expect.arrayContaining([
      'logicalModels',
      'logicalModels[*].id',
      'request.body',
      'request.body.model',
      'route.protocol',
      'route.transport',
    ]))
    // 「可用逻辑模型 id」与「请求模型」都不派生：前者用通配投影现算，后者直接读请求自己。
    expect(paths).not.toContain('route.availableModelIds')
    // 请求头整体作为一个不透明字段暴露，不展开成用不了的点路径。
    expect(paths).toContain('request.headers')
    expect(paths).not.toContain('request.headers.x-provider')
    // 协议归一化的中间结果只进 trace，不再污染 payload。
    expect(paths).not.toContain('route.protocolOutput')
    expect(paths).not.toContain('metadata.protocolOutput')
  })

  it('输入节点只给协议无关字段，逻辑模型投影不依赖任何示例数据', () => {
    // 入口节点不解析请求体：体里有哪些字段、是什么格式由协议决定，
    // 所以这里能声称的只有请求行、请求头、体整体，以及调用方自带的 metadata。
    // 逻辑模型列表是运行时注入的，任何静态示例里都不会有它，
    // 所以这组通配投影必须无条件出现 —— 命中判断 `logicalModels[*].id` 靠它。
    const target = condition('target')
    const hints = resolveInputHints(
      t,
      graph([input(), target, output()], [edge('input', 'out', 'target')]),
      target.id,
    )
    const field = (path: string) => hints.fields.find(item => item.path === path)

    expect(hints.fields.map(item => item.path)).toEqual([
      'request.path',
      'request.method',
      'request.headers',
      'request.body',
      'metadata',
      'logicalModels',
      'logicalModels[*].id',
      'logicalModels[*].enabled',
    ])
    expect(field('request.headers')).toMatchObject({ valueType: 'object', sourceNodeId: 'input' })
    expect(field('request.body')).toMatchObject({ valueType: 'object', sourceNodeId: 'input' })
    // 整体字段都带说明，告诉用户「要按属性比较得先接协议发现节点」。
    expect(field('request.body')?.note).toBeTruthy()
    expect(field('metadata')?.note).toBeTruthy()
    expect(field('logicalModels')).toMatchObject({ valueType: 'array', sourceNodeId: 'input' })
    expect(field('logicalModels')?.note).toBeTruthy()
    expect(field('logicalModels[*].id')).toMatchObject({ valueType: 'string', sourceNodeId: 'input' })
    expect(field('logicalModels[*].enabled')).toMatchObject({ valueType: 'boolean' })
  })

  it('协议发现节点按连接端口给出该协议解析后的请求体字段', () => {
    // 三种协议的消息在不同位置：`/v1/responses` 在 `input`，其余在 `messages`。
    // 这正是入口节点不可能知道的事，所以字段只能由协议节点按端口给。
    const target = condition('target')
    const hints = resolveInputHints(
      t,
      graph([input(), protocol('protocol'), target, output()], [
        edge('input', 'out', 'protocol'),
        edge('protocol', 'openai-completions', 'target'),
        edge('protocol', 'openai-responses', 'target'),
      ]),
      target.id,
    )
    const field = (path: string) => hints.fields.find(item => item.path === path)

    expect(field('request.body.messages')).toMatchObject({ valueType: 'array', sourceNodeId: 'protocol', sourcePort: 'openai-completions' })
    expect(field('request.body.messages[*].content')).toMatchObject({ valueType: 'string' })
    expect(field('request.body.input')).toMatchObject({ valueType: 'array', sourceNodeId: 'protocol', sourcePort: 'openai-responses' })
    expect(field('request.body.model')).toMatchObject({ valueType: 'string', sourceNodeId: 'protocol' })
    expect(field('request.body.model')?.note).toBeTruthy()
    // 没接上的协议不进入候选表：没接 `anthropic-messages` 端口就没有 `system`。
    expect(field('request.body.system')).toBeUndefined()
  })

  it('遍历迭代节点向循环体暴露 route.iteration 作用域', () => {
    const target = condition('body-condition')
    const iteration: WorkflowNodeModel = {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历迭代',
      enabled: true,
      description: '',
      position,
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.iterationResult',
      maxIterations: 10,
    }
    const hints = resolveInputHints(
      t,
      graph([input(), iteration, target, output()], [edge('input', 'out', 'iteration'), edge('iteration', 'body', 'body-condition')]),
      target.id,
    )
    const paths = hints.fields.map(item => item.path)

    expect(paths).toEqual(expect.arrayContaining([
      'route.iteration.item',
      'route.iteration.index',
      'route.iteration.key',
      'route.iteration.total',
      'route.modelIds',
      'route.iterationResult',
    ]))
    // 作用域字段挂在 body 端口上；来源字段推不出类型时按 unknown 处理（不限制操作符）。
    expect(hints.fields.find(item => item.path === 'route.iteration.item')).toMatchObject({ valueType: 'unknown', sourcePort: 'body' })
    expect(hints.fields.find(item => item.path === 'route.iteration.index')).toMatchObject({ valueType: 'number' })
    expect(hints.fields.find(item => item.path === 'route.iteration.key')).toMatchObject({ valueType: 'string' })
    // 汇总结果与每轮收集路径走 out 端口。
    expect(hints.fields.find(item => item.path === 'route.iterationResult')).toMatchObject({ sourcePort: 'out' })
  })

  it('遍历来源是标量字段时，item 沿用该字段的类型', () => {
    const target = condition('body-condition')
    const iteration: WorkflowNodeModel = {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历迭代',
      enabled: true,
      description: '',
      position,
      sourcePath: 'request.path',
      collectPath: '',
      collectMode: 'count',
      resultPath: '',
      maxIterations: 5,
    }
    const hints = resolveInputHints(
      t,
      graph([input(), iteration, target, output()], [edge('input', 'out', 'iteration'), edge('iteration', 'body', 'body-condition')]),
      target.id,
    )

    expect(hints.fields.find(item => item.path === 'route.iteration.item')).toMatchObject({ valueType: 'string' })
    // 未配置的收集 / 结果路径不产生空路径字段。
    expect(hints.fields.map(item => item.path)).not.toContain('')
    expect(hints.fields.find(item => item.path === 'route.modelIds')).toBeUndefined()
  })
})

/**
 * 内置策略 × 字段候选表的契约。
 *
 * 图「能跑」和「改得动」是两件事：payload 里本来就有整个请求体，
 * 所以哪怕策略读的是没有任何上游节点声明过的路径，运行时照样算得出结果，测试也全绿 ——
 * 但用户在脚本编辑器里补全不出这个路径、在条件下拉里选不到这个字段，这张图就是死的。
 *
 * 所以这里按面板的口径反查一遍：把每个策略节点真正读的路径抽出来
 * （条件字段、变量取值、遍历来源、脚本里的 `get('…')`、提示词里的 `${…}`），
 * 要求它必须出现在**该节点自己的候选表**里。候选表口径与面板共用同一份实现
 * （`panel/field-candidates.ts`），所以「面板换了过滤条件」和「预设写了候选表之外的路径」
 * 都会在这里红掉，而不是等用户点开面板才发现。
 */

/** 脚本里读取 payload 的唯一入口。 */
const SCRIPT_GET_PATTERN = /get\(\s*'([^']*)'\s*\)/g
/** 提示词模板里的插值变量。 */
const TEMPLATE_PATTERN = /\$\{([^}]*)\}/g
/**
 * `get(条件 ? '路径甲' : '路径乙')` 这种**按条件选路径**的写法。
 *
 * 上面那条 `get('…')` 抓不到它：外层的 `get(` 后面跟的是 `get(`，不是引号。
 * 不补这一条，「协议专有字段必须按 `route.protocol` 取舍」这条契约就看不见被取舍的
 * 究竟是哪两条路径 —— 预设改成按请求路径挑分支（而不是按 `route.protocol`）也照样全绿。
 */
const TERNARY_BRANCH_PATTERN = /\?\s*'([^']+)'\s*:\s*'([^']+)'/g
/** 路径样子的字面量：以输入 / 路由 / 元数据命名空间开头。用来把 `? 'complex' : 'simple'` 这类排除掉。 */
const PATH_LIKE_PATTERN = /^(request|route|logicalModels|metadata)($|[.[])/

function readPathsInText(text: string): string[] {
  const paths: string[] = []
  for (const match of text.matchAll(SCRIPT_GET_PATTERN)) paths.push(match[1])
  for (const match of text.matchAll(TEMPLATE_PATTERN)) paths.push(match[1].trim())
  for (const match of text.matchAll(TERNARY_BRANCH_PATTERN)) {
    for (const branch of [match[1], match[2]]) {
      if (PATH_LIKE_PATTERN.test(branch.trim())) paths.push(branch)
    }
  }
  return paths
}

/** 一个节点真正会去读的路径；空字符串（没填的路径）不算。 */
function readPathsOf(node: WorkflowNodeModel): string[] {
  const conditionRules = node.kind === 'condition'
    ? node.cases.flatMap(conditionCase => conditionCase.conditions)
    : []
  const conditionPaths = conditionRules.flatMap(rule =>
    rule.valueSource === 'field' && rule.valueFieldPath ? [rule.fieldPath, rule.valueFieldPath] : [rule.fieldPath])

  const paths = (() => {
    if (node.kind === 'model-select') return node.source === 'variable' ? [node.variablePath] : []
    if (node.kind === 'iteration') return [node.sourcePath]
    if (node.kind === 'script') return readPathsInText(node.code)
    if (node.kind === 'prompt') return readPathsInText(`${node.systemPrompt}\n${node.promptTemplate}`)
    return conditionPaths
  })()

  return paths.map(path => path.trim()).filter(Boolean)
}

/** 预设生成用的逻辑模型列表：`default` 是兜底落点，另两个给分流落点用。 */
const presetModels: RuntimeLogicalModel[] = [
  { id: 'default', name: 'Default', enabled: true },
  { id: 'model-fast', name: 'Model Fast', enabled: true },
  { id: 'model-smart', name: 'Model Smart', enabled: true },
]

describe('内置策略 × 字段候选表', () => {
  const builtInGraphs: { id: string, graph: WorkflowGraph }[] = [
    { id: 'blank', graph: createBlankGraph() },
    ...ROUTER_POLICY_PRESETS.map(preset => ({ id: preset.id, graph: preset.createGraph(presetModels) })),
  ]

  it.each(builtInGraphs.map(item => [item.id, item.graph] as const))('%s：引用的路径都能在自己的面板里选到', (_id, builtInGraph) => {
    const violations: string[] = []

    for (const node of builtInGraph.nodes) {
      const kind = node.kind as FieldReadKind
      if (!FIELD_READ_KINDS.includes(kind)) continue

      const candidatePaths = new Set(
        readCandidates(kind, resolveInputHints(t, builtInGraph, node.id).fields).map(field => field.path),
      )

      for (const path of readPathsOf(node)) {
        if (!candidatePaths.has(path)) violations.push(`${node.id}（${node.kind}）引用了候选表里没有的路径：${path}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('读协议层字段的策略必须先接上协议发现节点', () => {
    // 上一条用例已经能拦住「读了一个没人声明的路径」，这里把结论说成人话：
    // 请求体里的具体字段（`messages` / `model` / `tools` …）只有协议发现节点给得了，
    // 所以任何读它们的策略图里都必须有协议发现节点，否则那几条路径在运行时只会读到空值。
    const bodyFieldPattern = /^request\.body\.[^.]/

    for (const { id, graph } of builtInGraphs) {
      const readsBodyField = graph.nodes.some(node =>
        readPathsOf(node).some(path => bodyFieldPattern.test(path)))
      if (!readsBodyField) continue

      expect({ id, hasProtocolNode: graph.nodes.some(node => node.kind === 'protocol-discovery') })
        .toEqual({ id, hasProtocolNode: true })
    }
  })

  it('只在某一种协议里存在的请求体字段，预设必须按 route.protocol 取舍', () => {
    // 少这一条就会漏掉「只覆盖了其中一种协议」的写法：`request.body.messages` 在
    // completions / anthropic 下是消息列表，在 responses 下压根不存在（那里叫 `input`）。
    // 预设是给「协议还没确定」的用户看的样板，所以读这种协议专有字段时，
    // 必须显式引用 `route.protocol`（协议发现节点写的一手事实）来决定读哪一条，
    // 而不是「先试 messages、取不到再试 input」——体里两者都有时会读错那一个。
    // 每种协议都有的字段（`model` / `tools`）不受这条约束；`request.body` 整体更是谁都读得到。
    const knownProtocols = ALL_WORKFLOW_PROTOCOLS.filter(protocol => protocol !== 'unknown')
    const bodyFieldPattern = /^request\.body\.([^.]+)$/
    const declares = (protocol: WorkflowProtocol, field: string) =>
      (requestShapeOf(protocol)?.fields ?? []).some(candidate => candidate.path === `request.body.${field}`)

    for (const { id, graph } of builtInGraphs) {
      const fields = new Set<string>()
      let referencesProtocol = false
      for (const node of graph.nodes) {
        for (const path of readPathsOf(node)) {
          if (path === 'route.protocol') referencesProtocol = true
          const match = bodyFieldPattern.exec(path)
          if (match) fields.add(match[1])
        }
      }

      const protocolSpecific = [...fields]
        .filter(field => !knownProtocols.every(protocol => declares(protocol, field)))
        .sort()
      if (protocolSpecific.length === 0) continue

      expect({ id, protocolSpecific, referencesProtocol })
        .toEqual({ id, protocolSpecific, referencesProtocol: true })
    }
  })
})
