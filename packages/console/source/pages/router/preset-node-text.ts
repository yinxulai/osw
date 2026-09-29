import type { UiCatalogKey } from '@common/i18n/catalogs'
import { ROUTER_POLICY_PRESETS } from '@common/router/presets'
import type { WorkflowNodeModel } from '@common/router/types'

export interface PresetNodeTextKeys {
  name: UiCatalogKey
  description: UiCatalogKey
  text?: UiCatalogKey
  caseNames?: Record<string, UiCatalogKey>
}

export interface PresetNodeTextSource {
  keys: PresetNodeTextKeys
  origin: WorkflowNodeModel
}

/**
 * 内置预设节点的展示文案。
 *
 * 这份表必须和 `@common/router/presets.ts` 里生成的内置节点 id 一一对应。
 * 预设图数据仍是服务端与渲染层共用的稳定值；界面只在确认节点字段仍未修改时，
 * 用当前语言覆盖一份展示副本。用户改过的字段保持原样，保存的图也不会被翻译污染。
 */
const PRESET_NODE_TEXT_KEYS: Record<string, Record<string, PresetNodeTextKeys>> = {
  'model-direct': {
    'note-usage': {
      name: 'router.preset.modelDirect.note.name',
      description: 'router.preset.modelDirect.note.description',
      text: 'router.preset.modelDirect.note.text',
    },
    protocol: {
      name: 'router.preset.modelDirect.protocol.name',
      description: 'router.preset.modelDirect.protocol.description',
    },
    condition: {
      name: 'router.preset.modelDirect.condition.name',
      description: 'router.preset.modelDirect.condition.description',
      caseNames: {
        'case-1': 'router.preset.modelDirect.case.modelInList',
      },
    },
    'model-direct': {
      name: 'router.preset.modelDirect.model.name',
      description: 'router.preset.modelDirect.model.description',
    },
    'model-default': {
      name: 'router.preset.modelDirect.fallback.name',
      description: 'router.preset.modelDirect.fallback.description',
    },
  },
  'ua-source-routing': {
    'note-usage': {
      name: 'router.preset.userAgent.note.name',
      description: 'router.preset.userAgent.note.description',
      text: 'router.preset.userAgent.note.text',
    },
    iteration: {
      name: 'router.preset.userAgent.iteration.name',
      description: 'router.preset.userAgent.iteration.description',
    },
    'ua-condition': {
      name: 'router.preset.userAgent.condition.name',
      description: 'router.preset.userAgent.condition.description',
      caseNames: {
        'case-cursor': 'router.preset.userAgent.case.cursor',
        'case-claude-cli': 'router.preset.userAgent.case.claudeCli',
      },
    },
    'model-cursor': {
      name: 'router.preset.userAgent.cursor.name',
      description: 'router.preset.userAgent.cursor.description',
    },
    'model-claude-cli': {
      name: 'router.preset.userAgent.claudeCli.name',
      description: 'router.preset.userAgent.claudeCli.description',
    },
    'fallback-model': {
      name: 'router.preset.userAgent.fallback.name',
      description: 'router.preset.userAgent.fallback.description',
    },
  },
  'llm-complexity-routing': {
    'note-usage': {
      name: 'router.preset.llmComplexity.note.name',
      description: 'router.preset.llmComplexity.note.description',
      text: 'router.preset.llmComplexity.note.text',
    },
    'complexity-prompt': {
      name: 'router.preset.llmComplexity.prompt.name',
      description: 'router.preset.llmComplexity.prompt.description',
    },
    'complexity-condition': {
      name: 'router.preset.llmComplexity.condition.name',
      description: 'router.preset.llmComplexity.condition.description',
      caseNames: {
        'case-complex': 'router.preset.llmComplexity.case.complex',
      },
    },
    'model-complex': {
      name: 'router.preset.llmComplexity.complex.name',
      description: 'router.preset.llmComplexity.complex.description',
    },
    'model-simple': {
      name: 'router.preset.llmComplexity.simple.name',
      description: 'router.preset.llmComplexity.simple.description',
    },
  },
  'script-routing': {
    'note-usage': {
      name: 'router.preset.script.note.name',
      description: 'router.preset.script.note.description',
      text: 'router.preset.script.note.text',
    },
    protocol: {
      name: 'router.preset.script.protocol.name',
      description: 'router.preset.script.protocol.description',
    },
    'complexity-script': {
      name: 'router.preset.script.script.name',
      description: 'router.preset.script.script.description',
    },
    'complexity-condition': {
      name: 'router.preset.script.condition.name',
      description: 'router.preset.script.condition.description',
      caseNames: {
        'case-complex': 'router.preset.script.case.complex',
      },
    },
    'model-complex': {
      name: 'router.preset.script.complex.name',
      description: 'router.preset.script.complex.description',
    },
    'model-simple': {
      name: 'router.preset.script.simple.name',
      description: 'router.preset.script.simple.description',
    },
  },
}

export function presetNodeTextKeys(presetId: string, nodeId: string): PresetNodeTextKeys | undefined {
  return PRESET_NODE_TEXT_KEYS[presetId]?.[nodeId]
}

/**
 * 预设节点原文候选。
 *
 * 同名 id 会跨预设出现（例如 protocol / complexity-condition），这里先用空模型池生成各预设，
 * 实际展示时再按未修改字段的匹配数选出最像的来源。
 */
const PRESET_NODE_TEXT_SOURCES: PresetNodeTextSource[] = ROUTER_POLICY_PRESETS.flatMap((preset) => {
  const keysByNodeId = PRESET_NODE_TEXT_KEYS[preset.id]
  if (!keysByNodeId) return []

  return preset.createGraph([]).nodes.flatMap((node) => {
    const keys = keysByNodeId[node.id]
    return keys ? [{ keys, origin: node }] : []
  })
})

function sourceMatchScore(node: WorkflowNodeModel, source: WorkflowNodeModel): number {
  if (node.kind !== source.kind) return -1

  let score = 0
  if (node.name === source.name) score += 1
  if (node.description === source.description) score += 1

  if (node.kind === 'note' && source.kind === 'note' && node.text === source.text) score += 2

  if (node.kind === 'condition' && source.kind === 'condition') {
    for (const conditionCase of node.cases) {
      const originCase = source.cases.find(item => item.id === conditionCase.id)
      if (originCase?.name === conditionCase.name) score += 1
    }
  }

  if (node.kind === 'control-input' && source.kind === 'control-input') {
    for (const control of node.controls) {
      const originControl = source.controls.find(item => item.id === control.id)
      if (originControl?.label === control.label) score += 1
    }
  }

  return score
}

export function presetNodeTextSource(node: WorkflowNodeModel): PresetNodeTextSource | undefined {
  let best: PresetNodeTextSource | undefined
  let bestScore = 0

  for (const source of PRESET_NODE_TEXT_SOURCES) {
    if (source.origin.id !== node.id) continue
    const score = sourceMatchScore(node, source.origin)
    if (score > bestScore) {
      best = source
      bestScore = score
    }
  }

  return best
}
