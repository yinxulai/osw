import type { ComponentType } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  Braces,
  CirclePlay,
  GitBranch,
  Repeat2,
  Sparkles,
  SquareCode,
  StickyNote,
  Waypoints,
} from 'lucide-react'

import type { NodeRunStatus } from './node-data'
import {
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  type AppendableKind,
  type IterationCollectMode,
  type NoteNode,
  type NoteNodeSize,
  type WorkflowNodeKind,
  type WorkflowNodeModel,
} from '@common/router/types'
import type { AppTranslator } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { presetNodeTextSource } from './preset-node-text'

/** React Flow 中注册的节点类型名。 */
export type CanvasNodeType =
  | 'route-input'
  | 'control-input'
  | 'route-output'
  | 'protocol-discovery'
  | 'condition'
  | 'model-select'
  | 'iteration'
  | 'script'
  | 'prompt'
  | 'note'

/**
 * 用户可以往图上新增的节点类型。
 * 备注排最后：它是画布上的旁注，不属于路由语义，列表里也不应该抢在真节点前面。
 */
export const APPENDABLE_KINDS: AppendableKind[] = [
  'control-input',
  'protocol-discovery',
  'condition',
  'model-select',
  'iteration',
  'script',
  'prompt',
  'note',
]

/** 画布默认列顺序：用于旧数据的自动布局。 */
export const NODE_KIND_ORDER: WorkflowNodeKind[] = [
  'input',
  'control-input',
  'protocol-discovery',
  'condition',
  'iteration',
  'script',
  'prompt',
  'model-select',
  'output',
  // 备注单独占一列：旧数据做列式布局时它不会挤在别的节点上。
  'note',
]

export type NodeKindIcon = ComponentType<{ className?: string }>

export interface NodeKindMeta {
  /** 节点类型名称目录键 */
  labelKey: UiCatalogKey
  /** 一句话说明的目录键，用于选择器与节点面板 */
  hintKey: UiCatalogKey
  icon: NodeKindIcon
  /** 图标色块底色（对齐上游 `block-icon.tsx` 的 util-colors-*-500 纯色块，前景固定白色） */
  tone: string
}

export const NODE_KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = {
  input: {
    labelKey: 'router.node.input.label',
    hintKey: 'router.node.input.hint',
    icon: CirclePlay,
    tone: 'bg-util-colors-blue-brand-blue-brand-500',
  },
  'control-input': {
    labelKey: 'router.node.control-input.label',
    hintKey: 'router.node.control-input.hint',
    icon: ArrowRightLeft,
    tone: 'bg-util-colors-blue-blue-500',
  },
  'protocol-discovery': {
    labelKey: 'router.node.protocol-discovery.label',
    hintKey: 'router.node.protocol-discovery.hint',
    icon: GitBranch,
    tone: 'bg-util-colors-green-green-500',
  },
  condition: {
    labelKey: 'router.node.condition.label',
    hintKey: 'router.node.condition.hint',
    icon: Waypoints,
    tone: 'bg-util-colors-cyan-cyan-500',
  },
  'model-select': {
    labelKey: 'router.node.model-select.label',
    hintKey: 'router.node.model-select.hint',
    icon: ArrowRightLeft,
    tone: 'bg-util-colors-indigo-indigo-500',
  },
  iteration: {
    labelKey: 'router.node.iteration.label',
    hintKey: 'router.node.iteration.hint',
    icon: Repeat2,
    tone: 'bg-util-colors-violet-violet-500',
  },
  script: {
    labelKey: 'router.node.script.label',
    hintKey: 'router.node.script.hint',
    icon: SquareCode,
    tone: 'bg-util-colors-yellow-yellow-500',
  },
  prompt: {
    labelKey: 'router.node.prompt.label',
    hintKey: 'router.node.prompt.hint',
    icon: Sparkles,
    tone: 'bg-util-colors-pink-pink-500',
  },
  note: {
    labelKey: 'router.node.note.label',
    hintKey: 'router.node.note.hint',
    icon: StickyNote,
    // 便签用暖色：它和脚本节点的黄色调最接近，但走的是 amber 而不是 util-colors-yellow，
    // 保证“便签”和“脚本分支”在画布上不会认错。
    tone: 'bg-amber-500',
  },
  output: {
    labelKey: 'router.node.output.label',
    hintKey: 'router.node.output.hint',
    icon: ArrowRight,
    tone: 'bg-util-colors-warning-warning-500',
  },
}

export const FALLBACK_NODE_ICON = Braces

/** 迭代节点的结果收集模式文案键（节点视图、面板、Trace 共用）。 */
export const ITERATION_COLLECT_MODE_LABELS: Record<IterationCollectMode, UiCatalogKey> = {
  first: 'router.iterationMode.first',
  last: 'router.iterationMode.last',
  list: 'router.iterationMode.list',
  count: 'router.iterationMode.count',
}

/** 迭代节点的结果收集模式说明键，用于面板里的候选项补充解释。 */
export const ITERATION_COLLECT_MODE_HINTS: Record<IterationCollectMode, UiCatalogKey> = {
  first: 'router.iterationModeHint.first',
  last: 'router.iterationModeHint.last',
  list: 'router.iterationModeHint.list',
  count: 'router.iterationModeHint.count',
}

export function toCanvasNodeType(kind: WorkflowNodeKind): CanvasNodeType {
  if (kind === 'input') return 'route-input'
  if (kind === 'output') return 'route-output'
  return kind
}

export function kindLabel(t: AppTranslator, kind: WorkflowNodeKind): string {
  const key = NODE_KIND_META[kind]?.labelKey
  return key ? t(key) : t('router.summary.unknownKind')
}

export function kindIcon(kind: WorkflowNodeKind): NodeKindIcon {
  return NODE_KIND_META[kind]?.icon ?? FALLBACK_NODE_ICON
}

export function kindTone(kind: WorkflowNodeKind): string {
  return NODE_KIND_META[kind]?.tone ?? 'bg-primary'
}

export function nodeSummary(t: AppTranslator, model: WorkflowNodeModel): string {
  if (model.kind === 'input') return t(NODE_KIND_META.input.hintKey)
  if (model.kind === 'control-input') return t('router.summary.controls', { count: model.controls.filter(control => control.enabled).length })
  if (model.kind === 'protocol-discovery') return t(NODE_KIND_META['protocol-discovery'].hintKey)
  if (model.kind === 'condition') return t('router.summary.cases', { count: model.cases.length })
  if (model.kind === 'model-select') {
    if (model.source === 'variable') {
      const variablePath = model.variablePath.trim()
      return variablePath ? t('router.summary.variablePath', { path: variablePath }) : t('router.summary.variablePathEmpty')
    }
    return t('router.summary.models', { count: model.modelIds.length })
  }
  if (model.kind === 'iteration') {
    const sourcePath = model.sourcePath.trim()
    if (!sourcePath) return t('router.summary.iterationSourceEmpty')
    return t('router.summary.iterationSource', { path: sourcePath, count: model.maxIterations })
  }
  if (model.kind === 'script') {
    const resultPath = model.resultPath.trim()
    return resultPath ? t('router.summary.resultPath', { path: resultPath }) : t('router.summary.resultPathEmpty')
  }
  if (model.kind === 'prompt') {
    const logicalModelId = model.logicalModelId.trim()
    return logicalModelId ? t('router.summary.logicalModel', { id: logicalModelId }) : t('router.summary.logicalModelEmpty')
  }
  if (model.kind === 'note') {
    const text = model.text.trim()
    return text ? t('router.summary.noteChars', { count: model.text.length }) : t('router.summary.noteEmpty')
  }
  return t(NODE_KIND_META.output.hintKey)
}

export function nodePanelHint(t: AppTranslator, model: WorkflowNodeModel): string {
  if (model.kind === 'input') return t('router.panelHint.input')
  if (model.kind === 'output') return t('router.panelHint.output')
  if (model.kind === 'control-input') return t('router.panelHint.controlInput')
  if (model.kind === 'protocol-discovery') return t('router.panelHint.protocolDiscovery')
  if (model.kind === 'condition') return t('router.panelHint.condition')
  if (model.kind === 'model-select') return t('router.panelHint.modelSelect')
  if (model.kind === 'iteration') return t('router.panelHint.iteration')
  if (model.kind === 'script') return t('router.panelHint.script')
  if (model.kind === 'prompt') return t('router.panelHint.prompt')
  if (model.kind === 'note') return t('router.panelHint.note')
  return t('router.panelHint.fallback')
}

interface NodeTextKeys {
  name: UiCatalogKey
  description: UiCatalogKey
  text?: UiCatalogKey
  controlLabel?: UiCatalogKey
  caseName?: UiCatalogKey
  caseNames?: Record<string, UiCatalogKey>
}

/** 固定入口 / 出口的展示文案。它们不可编辑，可以安全地按界面语言渲染。 */
const FIXED_NODE_TEXT_KEYS: Partial<Record<WorkflowNodeKind, NodeTextKeys>> = {
  input: {
    name: 'router.node.input.label',
    description: 'router.node.input.hint',
  },
  output: {
    name: 'router.node.output.label',
    description: 'router.node.output.hint',
  },
}

/** 从节点选择器新建节点时的展示文案；只覆盖文案，不改节点协议字段。 */
const NEW_NODE_TEXT_KEYS: Record<AppendableKind, NodeTextKeys> = {
  'control-input': {
    name: 'router.factory.controlInput.name',
    description: 'router.factory.controlInput.description',
    controlLabel: 'router.factory.controlInput.controlLabel',
  },
  'protocol-discovery': {
    name: 'router.factory.protocolDiscovery.name',
    description: 'router.factory.protocolDiscovery.description',
  },
  condition: {
    name: 'router.factory.condition.name',
    description: 'router.factory.condition.description',
    caseName: 'router.factory.condition.caseName',
  },
  'model-select': {
    name: 'router.factory.modelSelect.name',
    description: 'router.factory.modelSelect.description',
  },
  iteration: {
    name: 'router.factory.iteration.name',
    description: 'router.factory.iteration.description',
  },
  script: {
    name: 'router.factory.script.name',
    description: 'router.factory.script.description',
  },
  prompt: {
    name: 'router.factory.prompt.name',
    description: 'router.factory.prompt.description',
  },
  note: {
    name: 'router.factory.note.name',
    description: 'router.factory.note.description',
    text: 'router.factory.note.text',
  },
}

function shouldTranslateText(current: string, origin: string | undefined, allowMissingOrigin = true): boolean {
  if (origin === undefined) return allowMissingOrigin
  return current === origin
}

function withNodeText<T extends WorkflowNodeModel>(t: AppTranslator, node: T, keys: NodeTextKeys, origin?: WorkflowNodeModel): T {
  const next = {
    ...node,
    name: shouldTranslateText(node.name, origin?.name) ? t(keys.name) : node.name,
    description: shouldTranslateText(node.description, origin?.description) ? t(keys.description) : node.description,
  }
  if (node.kind === 'note' && keys.text) {
    const sourceText = origin?.kind === 'note' ? origin.text : undefined
    return {
      ...next,
      text: shouldTranslateText(node.text, sourceText, origin === undefined) ? t(keys.text) : node.text,
    } as T
  }
  if (node.kind === 'control-input' && keys.controlLabel) {
    const originControls = origin?.kind === 'control-input' ? origin.controls : []
    return {
      ...next,
      controls: node.controls.map((control) => {
        const sourceControl = originControls.find(item => item.id === control.id)
        return shouldTranslateText(control.label, sourceControl?.label, origin === undefined)
          ? { ...control, label: t(keys.controlLabel!) }
          : control
      }),
    } as T
  }
  if (node.kind === 'condition' && (keys.caseName || keys.caseNames)) {
    const originCases = origin?.kind === 'condition' ? origin.cases : []
    return {
      ...next,
      cases: node.cases.map((conditionCase) => {
        const key = keys.caseNames?.[conditionCase.id] ?? keys.caseName
        if (!key) return conditionCase
        const sourceCase = originCases.find(item => item.id === conditionCase.id)
        return shouldTranslateText(conditionCase.name, sourceCase?.name, origin === undefined)
          ? { ...conditionCase, name: t(key) }
          : conditionCase
      }),
    } as T
  }
  return next as T
}

/**
 * 新建节点的本地化文案。
 *
 * 只改 `name` / `description` / 便签正文 / 条件分支名这类展示字段；脚本、落点等
 * 协议字段仍由 contracts 里的构造器生成，避免 UI 与引擎各长一套默认值。
 */
export function localizeNewNode<T extends WorkflowNodeModel>(t: AppTranslator, node: T): T {
  const keys = NEW_NODE_TEXT_KEYS[node.kind as AppendableKind]
  return keys ? withNodeText(t, node, keys) : node
}

/** 条件面板里新增分支时，把分支名按当前界面语言写入。 */
export function localizeNewConditionCase<T extends { name: string }>(t: AppTranslator, conditionCase: T): T {
  return { ...conditionCase, name: t('router.factory.condition.caseName') }
}

/** 控制输入面板里新增控制项时，把控制项名称按当前界面语言写入。 */
export function localizeNewControlItem<T extends { label: string }>(t: AppTranslator, control: T): T {
  return { ...control, label: t('router.factory.controlInput.controlLabel') }
}

/**
 * 画布与面板展示用的节点内容。
 *
 * 内置预设的文本是图数据，保存时必须保持稳定；这里只在渲染层按当前语言覆盖一份副本。
 * 传 `origin` 时逐字段比对：用户改过的字段原样显示，没改过的字段继续跟随界面语言。
 */
export function displayWorkflowNode(t: AppTranslator, node: WorkflowNodeModel): WorkflowNodeModel {
  const fixedKeys = FIXED_NODE_TEXT_KEYS[node.kind]
  if (fixedKeys) return withNodeText(t, node, fixedKeys)

  const source = presetNodeTextSource(node)
  if (source) return withNodeText(t, node, source.keys, source.origin)

  return node
}

/** 输入 / 输出节点为固定节点：名称与描述不可修改，也不可删除。 */
export function isProtectedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

/**
 * 便签的实际尺寸。
 *
 * `size` 是可选的（旧数据与手写图都可能没有），缺省时统一落回 `NOTE_DEFAULT_*`：
 * 画布、缩放手柄、面板「恢复默认尺寸」三处都走这里，不各写一份默认值。
 */
export function resolveNoteNodeSize(model: NoteNode): NoteNodeSize {
  return model.size ?? { width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT }
}

/**
 * 连线在“无状态、无交互”时的颜色。
 * 对应上游的 `--color-workflow-link-line-normal`。
 * 上游只有一种灰，本仓库额外按分支区分颜色，属于 OSW 的信息增强，
 * 分支色取自 util-colors 色板，保证明暗两套主题下都与节点图标同色系。
 */
export const EDGE_STROKE_NORMAL = 'var(--color-workflow-link-line-normal)'

/**
 * 连线被选中 / 悬浮 / 连接节点被悬浮时的颜色。
 * 对应上游的 `--color-workflow-link-line-handle`。
 */
export const EDGE_STROKE_HANDLE = 'var(--color-workflow-link-line-handle)'

const cyanStroke = 'var(--color-util-colors-cyan-cyan-500)'
const violetStroke = 'var(--color-util-colors-indigo-indigo-500)'
const emeraldStroke = 'var(--color-util-colors-blue-blue-500)'
const iterationStroke = 'var(--color-util-colors-violet-violet-500)'
const scriptStroke = 'var(--color-util-colors-yellow-yellow-500)'
const promptStroke = 'var(--color-util-colors-pink-pink-500)'

/** 连线颜色：按上游节点的类型与端口区分分支语义。 */
export function edgeStrokeColor(sourceKind: WorkflowNodeKind, sourcePort: string): string {
  if (sourceKind === 'protocol-discovery') {
    return sourcePort === 'unknown' ? 'var(--color-text-warning)' : cyanStroke
  }
  if (sourceKind === 'condition') {
    return sourcePort === 'else' ? EDGE_STROKE_NORMAL : 'var(--color-util-colors-green-green-500)'
  }
  if (sourceKind === 'model-select') return violetStroke
  if (sourceKind === 'control-input') return emeraldStroke
  if (sourceKind === 'iteration') return sourcePort === 'body' ? iterationStroke : EDGE_STROKE_NORMAL
  if (sourceKind === 'script') return scriptStroke
  if (sourceKind === 'prompt') return promptStroke
  return EDGE_STROKE_NORMAL
}

/**
 * 运行状态对应的连线颜色，对应上游 `app/components/workflow/utils/edge.ts` 的 `getEdgeColor`。
 * 未运行过（`idle`）时返回 undefined，交给调用方回落到分支色。
 */
export function edgeRunStatusStroke(status: NodeRunStatus | undefined): string | undefined {
  if (status === 'succeeded') return 'var(--color-workflow-link-line-success-handle)'
  if (status === 'failed') return 'var(--color-workflow-link-line-error-handle)'
  if (status === 'running') return 'var(--color-workflow-link-line-handle)'
  return undefined
}
