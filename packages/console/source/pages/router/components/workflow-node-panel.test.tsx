// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import type { SchemaFieldDescriptor, WorkflowNodeModel } from '@common/router/types'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import type { PanelLogicalModel } from '../node-data'
import { nodePanelHint } from '../node-meta'
import { WorkflowNodePanel } from './workflow-node-panel'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const position = { x: 0, y: 0 }

/** 面板里能看见的上游字段：字符串 / 数组 / 通配投影三种形态各一条。 */
const FIELD_HINTS: SchemaFieldDescriptor[] = [
  { path: 'request.path', valueType: 'string', sourceNodeId: 'input', sourcePort: 'out' },
  { path: 'request.body.model', valueType: 'string', sourceNodeId: 'input', sourcePort: 'out' },
  { path: 'logicalModels', valueType: 'array', sourceNodeId: 'input', sourcePort: 'out' },
  { path: 'logicalModels[*].id', valueType: 'string', sourceNodeId: 'input', sourcePort: 'out' },
]

/** 一个可选逻辑模型；刻意不写 `description`，让「该模型暂未配置有效说明」也进比对。 */
const LOGICAL_MODELS: PanelLogicalModel[] = [{ id: 'lm-fast', name: 'Fast', enabled: true }]

const inputNode: WorkflowNodeModel = {
  id: 'input',
  kind: 'input',
  name: '输入请求',
  enabled: true,
  description: '',
  position,
}

const outputNode: WorkflowNodeModel = {
  id: 'output',
  kind: 'output',
  name: '输出响应',
  enabled: true,
  description: '',
  position,
  includeTrace: true,
  summaryLevel: 'detailed',
}

const controlInputNode: WorkflowNodeModel = {
  id: 'control',
  kind: 'control-input',
  name: '控制输入',
  enabled: true,
  description: '',
  position,
  controls: [
    { id: 'control-1', key: 'turbo', label: '强力模式', kind: 'switch', enabled: true, defaultValue: false },
    {
      id: 'control-2',
      key: 'tier',
      label: '档位',
      kind: 'select',
      enabled: true,
      defaultValue: 'fast',
      options: [{ label: '快', value: 'fast' }, { label: '稳', value: 'safe' }],
    },
  ],
}

const protocolDiscoveryNode: WorkflowNodeModel = {
  id: 'protocol',
  kind: 'protocol-discovery',
  name: '协议发现',
  enabled: true,
  description: '',
  position,
}

const emptyConditionNode: WorkflowNodeModel = {
  id: 'condition-empty',
  kind: 'condition',
  name: '条件',
  enabled: true,
  description: '',
  position,
  cases: [],
}

const conditionNode: WorkflowNodeModel = {
  id: 'condition',
  kind: 'condition',
  name: '条件',
  enabled: true,
  description: '',
  position,
  cases: [
    {
      id: 'case-1',
      name: '命中模型',
      logicalOperator: 'and',
      conditions: [
        { fieldPath: 'request.path', valueType: 'string', operator: 'equals', valueSource: 'literal', value: '/v1/chat' },
        {
          fieldPath: 'logicalModels[*].id',
          valueType: 'string',
          operator: 'in',
          valueSource: 'field',
          valueFieldPath: 'request.body.model',
        },
        {
          fieldPath: 'request.body.ghost',
          valueType: 'string',
          operator: 'exists',
        },
      ],
    },
    {
      id: 'case-2',
      name: '兜底',
      logicalOperator: 'or',
      conditions: [],
    },
  ],
}

const fixedModelSelectNode: WorkflowNodeModel = {
  id: 'model-select-fixed',
  kind: 'model-select',
  name: '逻辑模型选择',
  enabled: true,
  description: '',
  position,
  source: 'fixed',
  variablePath: '',
  modelIds: ['lm-fast'],
  fallbackModelIds: [],
}

const variableModelSelectNode: WorkflowNodeModel = {
  id: 'model-select-variable',
  kind: 'model-select',
  name: '逻辑模型选择',
  enabled: true,
  description: '',
  position,
  source: 'variable',
  variablePath: 'request.body.model',
  modelIds: [],
  fallbackModelIds: [],
}

const listIterationNode: WorkflowNodeModel = {
  id: 'iteration-list',
  kind: 'iteration',
  name: '迭代',
  enabled: true,
  description: '',
  position,
  sourcePath: 'logicalModels',
  collectPath: 'route.iteration.item',
  collectMode: 'list',
  resultPath: 'route.modelIds',
  maxIterations: 5,
}

const countIterationNode: WorkflowNodeModel = {
  id: 'iteration-count',
  kind: 'iteration',
  name: '迭代',
  enabled: true,
  description: '',
  position,
  sourcePath: 'logicalModels[*].id',
  collectPath: 'route.iteration.item',
  collectMode: 'count',
  resultPath: '',
  maxIterations: 3,
}

const emptyScriptNode: WorkflowNodeModel = {
  id: 'script-empty',
  kind: 'script',
  name: '脚本',
  enabled: true,
  description: '',
  position,
  code: '',
  resultPath: 'route.scriptResult',
  timeoutMilliseconds: 2_000,
}

const scriptNode: WorkflowNodeModel = {
  id: 'script',
  kind: 'script',
  name: '脚本',
  enabled: true,
  description: '',
  position,
  code: "return get('logicalModels[*].id')",
  resultPath: '',
  timeoutMilliseconds: 2_000,
}

const emptyPromptNode: WorkflowNodeModel = {
  id: 'prompt-empty',
  kind: 'prompt',
  name: '提示词',
  enabled: true,
  description: '',
  position,
  logicalModelId: 'lm-fast',
  systemPrompt: '',
  promptTemplate: '',
  resultPath: 'route.reply',
  temperature: 0.2,
  maxTokens: 1_024,
  timeoutMilliseconds: 60_000,
}

const promptNode: WorkflowNodeModel = {
  id: 'prompt',
  kind: 'prompt',
  name: '提示词',
  enabled: true,
  description: '',
  position,
  logicalModelId: 'lm-gone',
  systemPrompt: '只回答 id',
  promptTemplate: '从 ${logicalModels[*].id} 里挑一个',
  resultPath: '',
  temperature: 0.2,
  maxTokens: 1_024,
  timeoutMilliseconds: 60_000,
}

interface NodePanelCase {
  label: string
  model: WorkflowNodeModel
  /** 上游字段候选，默认给 `FIELD_HINTS`；传空数组用来覆盖「暂无可用字段」那一档 */
  hints?: SchemaFieldDescriptor[]
  /** 可选逻辑模型，默认给 `LOGICAL_MODELS`；传空数组用来覆盖「暂无可用逻辑模型」那一档 */
  logicalModels?: PanelLogicalModel[]
}

/**
 * 每个节点至少一档「正常形态」，再补上会额外冒出提示 / 告警的形态：
 * 面板里所有 `NodePanelHint` 都要进比对，不能只测最干净的那种。
 */
const NODE_PANEL_CASES: NodePanelCase[] = [
  { label: '输入', model: inputNode },
  { label: '输出', model: outputNode },
  { label: '控制输入', model: controlInputNode },
  { label: '协议发现', model: protocolDiscoveryNode },
  { label: '条件（无分支）', model: emptyConditionNode },
  { label: '条件（含分支）', model: conditionNode },
  { label: '条件（无上游字段）', model: emptyConditionNode, hints: [] },
  { label: '逻辑模型选择（固定）', model: fixedModelSelectNode },
  { label: '逻辑模型选择（变量）', model: variableModelSelectNode },
  {
    label: '逻辑模型选择（变量·无字段·无模型）',
    model: variableModelSelectNode,
    hints: [],
    logicalModels: [],
  },
  { label: '迭代（列表汇总）', model: listIterationNode },
  { label: '迭代（只统计轮数）', model: countIterationNode },
  { label: '迭代（无上游字段）', model: countIterationNode, hints: [] },
  { label: '脚本（空脚本）', model: emptyScriptNode },
  { label: '脚本（无写回路径）', model: scriptNode },
  { label: '提示词（空模板）', model: emptyPromptNode },
  { label: '提示词（模型不存在·无写回路径）', model: promptNode },
]

interface PanelRenderOptions {
  hints?: SchemaFieldDescriptor[]
  logicalModels?: PanelLogicalModel[]
}

/** 渲染真实浮层，返回界面上实际出现的每一条说明（外壳那条在最前）。 */
function renderPanelNotes(model: WorkflowNodeModel, options: PanelRenderOptions): string[] {
  render(
    <WorkflowNodePanel
      model={model}
      canvasWidth={1_440}
      width={420}
      onWidthChange={() => {}}
      nodeModels={[model]}
      logicalModels={options.logicalModels ?? LOGICAL_MODELS}
      conditionFieldHints={options.hints ?? FIELD_HINTS}
      updateNode={() => {}}
      onDelete={() => {}}
      onClose={() => {}}
    />,
    { wrapper: I18nProvider },
  )

  return [...document.querySelectorAll('[role="note"]')].map(element => element.textContent ?? '')
}

/**
 * 只留汉字。
 *
 * 路径、标识符（`route.iteration.item`、`get(路径)` 之类）在两层文案里重复出现不算
 * 「又说了一遍」：它们是被引用的名字，不是被重述的句子。
 */
function hanOnly(text: string): string {
  return text.replace(/[^\u4e00-\u9fff]/g, '')
}

/** 两段文案里最长的连续公共汉字数（连续公共子串）。 */
function longestSharedHanRun(left: string, right: string): number {
  const width = right.length + 1
  let previous = new Array<number>(width).fill(0)
  let best = 0

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = new Array<number>(width).fill(0)
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (left[leftIndex] !== right[rightIndex]) continue
      const run = previous[rightIndex] + 1
      current[rightIndex + 1] = run
      if (run > best) best = run
    }
    previous = current
  }

  return best
}

interface RepeatedMeaning {
  hint: string
  note: string
  run: number
}

/** 连续这么多汉字一模一样，读起来就是同一句话写了两遍。 */
const REPEATED_RUN = 8

/** 节点定位句（外壳那条提示条）与面板内部说明之间的重述。 */
function findRepeatedMeaning(shellHint: string, notes: string[]): RepeatedMeaning | null {
  const normalizedHint = hanOnly(shellHint)

  for (const note of notes) {
    const run = longestSharedHanRun(normalizedHint, hanOnly(note))
    if (run >= REPEATED_RUN) return { hint: shellHint, note, run }
  }

  return null
}

describe('节点面板里的说明文案', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'zh-CN' })
  })

  it.each(NODE_PANEL_CASES)('$label：节点定位只说一遍', (testCase: NodePanelCase) => {
    const notes = renderPanelNotes(testCase.model, {
      hints: testCase.hints,
      logicalModels: testCase.logicalModels,
    })

    // 外壳永远先渲染节点定位句：面板正文里不该再出现同一句话。
    expect(notes[0]).toBe(nodePanelHint(createAppTranslator('zh-CN'), testCase.model))

    const repeated = findRepeatedMeaning(notes[0], notes.slice(1))
    expect(repeated).toBeNull()
  })
})

describe('重述检测器', () => {
  it('认得出「输入节点无可配置项」被写了两遍', () => {
    // 用户报的就是这一处：外壳说「输入节点无配置项，仅作为路由入口」，
    // 面板里又抄了一遍几乎一样的话。
    const repeated = findRepeatedMeaning(
      '输入节点无配置项，仅作为路由入口。',
      ['输入节点无可配置项，仅作为路由入口。'],
    )
    expect(repeated).not.toBeNull()
  })

  it('不把面板自己的补充事实当成重述', () => {
    // 脚本面板讲的是沙箱里能用什么（payload / get / console），
    // 与「在沙箱里执行脚本、结果写回路径」不是同一句话。
    const repeated = findRepeatedMeaning(
      '在服务端沙箱里执行脚本，返回值写入结果路径供下游使用。',
      ['沙箱里可用 payload、get(路径) 与 console。'],
    )
    expect(repeated).toBeNull()
  })
})
