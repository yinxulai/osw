import { describe, expect, it } from 'vitest'

import { createAppTranslator } from '@common/i18n/catalogs'
import {
  ROUTER_POLICY_PRESETS,
  createDefaultPolicyGraph,
  createInputNode,
  createNodeByKind,
  createNoteNode,
  createOutputNode,
} from '@common/router/presets'
import { WORKFLOW_NODE_KINDS } from '@common/router/types'
import type {
  AppendableKind,
  IterationCollectMode,
  WorkflowNodeKind,
  WorkflowNodeModel,
} from '@common/router/types'
import type { RuntimeLogicalModel } from '@common/router/types'
import { NOTE_DEFAULT_HEIGHT, NOTE_DEFAULT_WIDTH } from '@common/router/types'
import {
  APPENDABLE_KINDS,
  EDGE_STROKE_HANDLE,
  EDGE_STROKE_NORMAL,
  FALLBACK_NODE_ICON,
  ITERATION_COLLECT_MODE_HINTS,
  ITERATION_COLLECT_MODE_LABELS,
  NODE_KIND_META,
  NODE_KIND_ORDER,
  displayWorkflowNode,
  edgeRunStatusStroke,
  edgeStrokeColor,
  isProtectedNode,
  kindIcon,
  kindLabel,
  kindTone,
  localizeNewConditionCase,
  localizeNewControlItem,
  localizeNewNode,
  nodePanelHint,
  nodeSummary,
  resolveNoteNodeSize,
  toCanvasNodeType,
} from './node-meta'

const models: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'model-fast', enabled: true },
  { modelId: 'model-smart', enabled: true },
]

describe('内置工作流节点本地化', () => {
  it('英文界面展示时覆盖所有内置预设节点的名称与描述', () => {
    const t = createAppTranslator('en')

    for (const preset of ROUTER_POLICY_PRESETS) {
      for (const node of preset.createGraph(models).nodes) {
        const displayed = displayWorkflowNode(t, node)
        expect(displayed.name, `${preset.id}/${node.id} name`).not.toBe(node.name)
        expect(displayed.description, `${preset.id}/${node.id} description`).not.toBe(node.description)
      }
    }
  })

  it('内置便签正文与条件分支名也会按界面语言展示', () => {
    const t = createAppTranslator('en')
    const graph = createDefaultPolicyGraph(models)
    const note = graph.nodes.find(node => node.id === 'note-usage')
    const condition = graph.nodes.find(node => node.id === 'condition')

    expect(note && displayWorkflowNode(t, note)).toMatchObject({ text: expect.stringContaining('Default policy') })
    expect(condition && displayWorkflowNode(t, condition)).toMatchObject({
      cases: [expect.objectContaining({ name: 'The requested model is in the logical model list' })],
    })
  })

  it('用户改过的字段保持原样，其余内置字段继续本地化', () => {
    const t = createAppTranslator('en')
    const condition = createDefaultPolicyGraph(models).nodes.find(node => node.id === 'condition')
    if (!condition || condition.kind !== 'condition') throw new Error('condition node missing')

    const displayed = displayWorkflowNode(t, { ...condition, name: 'My condition' })
    expect(displayed.name).toBe('My condition')
    expect(displayed.description).toBe('When request.body.model is in logicalModels[*].modelId, use the direct branch; otherwise use the default logical model.')
    expect(displayed.kind).toBe('condition')
    if (displayed.kind !== 'condition') throw new Error('condition node missing')
    expect(displayed.cases[0].name).toBe('The requested model is in the logical model list')
  })

  it('新节点按当前界面语言写入默认展示文本', () => {
    const t = createAppTranslator('en')
    const note = localizeNewNode(t, createNodeByKind('note', { x: 0, y: 0 }))
    const condition = localizeNewNode(t, createNodeByKind('condition', { x: 0, y: 0 }))

    expect(note).toMatchObject({ name: 'Note', description: expect.stringContaining('sticky note'), text: expect.stringContaining('## Note') })
    expect(condition).toMatchObject({
      name: 'Condition node',
      description: expect.stringContaining('typed conditions'),
      cases: [expect.objectContaining({ name: 'Branch 1' })],
    })
  })
})

describe('节点元数据清单', () => {
  // 清单必须与 contracts 的节点全集一一对应：少一条就会让 `NODE_KIND_META[kind]`
  // 在画布上取到 undefined，多一条则是没人认识的僵尸类型。
  it('NODE_KIND_ORDER 恰好枚举了全部节点类型，且不重复', () => {
    expect([...NODE_KIND_ORDER].sort()).toEqual([...WORKFLOW_NODE_KINDS].sort())
    expect(new Set(NODE_KIND_ORDER).size).toBe(NODE_KIND_ORDER.length)
  })

  it('每个节点类型都有标签键、说明键、图标与色块底色', () => {
    for (const kind of WORKFLOW_NODE_KINDS) {
      const meta = NODE_KIND_META[kind]
      expect(meta, kind).toBeDefined()
      expect(meta.labelKey, kind).toMatch(/^router\.node\./)
      expect(meta.hintKey, kind).toMatch(/^router\.node\./)
      // lucide 的图标是 `forwardRef` 出来的对象而不是普通函数，这里只要求「有东西可渲染」。
      expect(meta.icon, kind).toBeTruthy()
      expect(kindIcon(kind), kind).toBe(meta.icon)
      expect(meta.tone, kind).toMatch(/^bg-/)
    }
  })

  // 备注是画布旁注，不是路由语义的一环：它可以新增，但绝不能排在其他节点前面。
  it('可新增类型不含固定入口/出口，且备注排在最后', () => {
    expect(APPENDABLE_KINDS).not.toContain('input')
    expect(APPENDABLE_KINDS).not.toContain('output')
    expect(APPENDABLE_KINDS[APPENDABLE_KINDS.length - 1]).toBe('note')
    expect([...APPENDABLE_KINDS].sort()).toEqual([...WORKFLOW_NODE_KINDS].filter(kind => kind !== 'input' && kind !== 'output').sort())
  })

  it('迭代结果收集模式的两组目录键覆盖全部模式', () => {
    const modes: IterationCollectMode[] = ['first', 'last', 'list', 'count']
    expect(Object.keys(ITERATION_COLLECT_MODE_LABELS).sort()).toEqual([...modes].sort())
    expect(Object.keys(ITERATION_COLLECT_MODE_HINTS).sort()).toEqual([...modes].sort())
    for (const mode of modes) {
      expect(ITERATION_COLLECT_MODE_LABELS[mode], mode).toMatch(/^router\.iterationMode\./)
      expect(ITERATION_COLLECT_MODE_HINTS[mode], mode).toMatch(/^router\.iterationModeHint\./)
    }
  })
})

describe('画布节点类型名', () => {
  it('入口与出口换成 React Flow 注册的专用类型名', () => {
    expect(toCanvasNodeType('input')).toBe('route-input')
    expect(toCanvasNodeType('output')).toBe('route-output')
  })

  it('其余类型沿用节点种类名', () => {
    for (const kind of WORKFLOW_NODE_KINDS) {
      if (kind === 'input' || kind === 'output') continue
      expect(toCanvasNodeType(kind), kind).toBe(kind)
    }
  })
})

describe('节点类型展示元数据', () => {
  const t = createAppTranslator('zh-CN')

  it('标签取自目录，中文界面下是真中文', () => {
    expect(kindLabel(t, 'input')).toBe('输入请求')
    expect(kindLabel(t, 'condition')).toBe('条件')
    expect(kindLabel(t, 'note')).toBe('备注')
    expect(kindLabel(t, 'output')).toBe('路由结果出口')
  })

  // 目录里没有的键会退化成兜底文案，而不是把 key 原文漏到界面上。
  it('未知类型回落到兜底标签而不是漏出键名', () => {
    const label = kindLabel(t, 'nope' as WorkflowNodeKind)
    expect(label).toBe('节点')
    expect(label).not.toContain('router.')
  })

  it('图标与色块取自各自节点的元数据', () => {
    expect(kindIcon('input')).toBe(NODE_KIND_META.input.icon)
    expect(kindIcon('note')).toBe(NODE_KIND_META.note.icon)
    expect(kindTone('condition')).toBe(NODE_KIND_META.condition.tone)
    expect(kindTone('note')).toBe('bg-amber-500')
  })

  it('未知类型的图标与底色也有兜底，不会渲染出 undefined', () => {
    expect(kindIcon('nope' as WorkflowNodeKind)).toBe(FALLBACK_NODE_ICON)
    expect(kindTone('nope' as WorkflowNodeKind)).toBe('bg-primary')
  })
})

describe('节点一句话摘要', () => {
  const t = createAppTranslator('zh-CN')
  const position = { x: 0, y: 0 }

  function node<K extends AppendableKind>(kind: K, patch: Record<string, unknown> = {}): WorkflowNodeModel {
    return { ...createNodeByKind(kind, position), ...patch } as WorkflowNodeModel
  }

  it('入口与出口直接用各自的说明文案', () => {
    expect(nodeSummary(t, createInputNode(position))).toBe('接收原始请求并开始路由')
    expect(nodeSummary(t, createOutputNode(position))).toBe('输出可用逻辑模型，交由代理执行')
  })

  // 控制项要按「启用」计数：关掉的那个不会真的注入，算进去会虚报。
  it('控制输入只数已启用的控制项', () => {
    const created = node('control-input')
    expect(created.kind).toBe('control-input')
    if (created.kind !== 'control-input') return
    const controls = created.controls.map((item, index) => ({ ...item, enabled: index === 0 }))
    expect(nodeSummary(t, { ...created, controls })).toBe('1 个控制项')
    expect(nodeSummary(t, { ...created, controls: [] })).toBe('0 个控制项')
  })

  it('条件、固定落点、协议发现各自汇总', () => {
    expect(nodeSummary(t, node('protocol-discovery'))).toBe('识别协议并输出分支')
    const condition = node('condition')
    expect(nodeSummary(t, condition)).toBe('1 个分支 + ELSE')
    expect(nodeSummary(t, node('model-select', { source: 'fixed', modelIds: ['a', 'b'] }))).toBe('2 个逻辑模型')
  })

  // 「变量落点」在摘要里必须显示取值字段本身，否则面板上看不出它到底读哪里。
  it('变量落点显示取值字段，空值时明说未选择', () => {
    expect(nodeSummary(t, node('model-select', { source: 'variable', variablePath: 'request.body.model' }))).toBe('取值字段 request.body.model')
    // 前后空白属于输入噪声，摘要里要裁掉。
    expect(nodeSummary(t, node('model-select', { source: 'variable', variablePath: '  request.body.model  ' }))).toBe('取值字段 request.body.model')
    expect(nodeSummary(t, node('model-select', { source: 'variable', variablePath: '   ' }))).toBe('未选择取值字段')
  })

  it('迭代节点显示遍历路径与轮数上限，空路径时明说未配置', () => {
    expect(nodeSummary(t, node('iteration', { sourcePath: 'logicalModels', maxIterations: 5 }))).toBe('遍历 logicalModels · 上限 5 轮')
    expect(nodeSummary(t, node('iteration', { sourcePath: '  ' }))).toBe('未配置遍历来源')
  })

  it('脚本节点显示结果写回路径，空路径时明说未配置', () => {
    expect(nodeSummary(t, node('script', { resultPath: 'route.scriptResult' }))).toBe('结果写入 route.scriptResult')
    expect(nodeSummary(t, node('script', { resultPath: '' }))).toBe('未配置结果写回路径')
  })

  it('LLM 节点显示逻辑模型 id，未选时明说', () => {
    expect(nodeSummary(t, node('prompt', { logicalModelId: 'fast' }))).toBe('逻辑模型 fast')
    expect(nodeSummary(t, node('prompt', { logicalModelId: ' ' }))).toBe('未选择逻辑模型')
  })

  // 备注的字数按**原文**长度算：`text` 带前导换行的 Markdown 不该被 trim 掉字数。
  it('备注显示正文字数，空白正文算空备注', () => {
    const note = createNoteNode(position, '一二三')
    expect(nodeSummary(t, note)).toBe('3 字')
    expect(nodeSummary(t, createNoteNode(position, '  \n '))).toBe('空备注')
    expect(nodeSummary(t, createNoteNode(position, ' a b '))).toBe('5 字')
  })
})

describe('节点面板说明', () => {
  const t = createAppTranslator('zh-CN')
  const position = { x: 0, y: 0 }

  it('每种节点都给得出说明文案', () => {
    for (const kind of WORKFLOW_NODE_KINDS) {
      const model = kind === 'input' || kind === 'output'
        ? (kind === 'input' ? createInputNode(position) : createOutputNode(position))
        : createNodeByKind(kind as AppendableKind, position)
      const hint = nodePanelHint(t, model)
      expect(hint, kind).toBeTruthy()
      expect(hint, kind).not.toContain('router.')
    }
  })

  it('说明文案区分节点种类，不是同一句通用话术', () => {
    const hints = new Set([
      nodePanelHint(t, createInputNode(position)),
      nodePanelHint(t, createOutputNode(position)),
      nodePanelHint(t, createNodeByKind('condition', position)),
      nodePanelHint(t, createNodeByKind('iteration', position)),
      nodePanelHint(t, createNodeByKind('script', position)),
      nodePanelHint(t, createNodeByKind('prompt', position)),
      nodePanelHint(t, createNodeByKind('model-select', position)),
      nodePanelHint(t, createNodeByKind('note', position)),
      nodePanelHint(t, createNodeByKind('control-input', position)),
      nodePanelHint(t, createNodeByKind('protocol-discovery', position)),
    ])
    expect(hints.size).toBe(10)
  })
})

describe('新增分支与控制项的本地化', () => {
  const t = createAppTranslator('zh-CN')

  it('新增分支名按当前界面语言写入', () => {
    const source = { id: 'case-1', name: 'Branch 1' }
    expect(localizeNewConditionCase(t, source)).toEqual({ id: 'case-1', name: '分支 1' })
    // 只改名字，id 必须原样带过去，否则面板与图数据会对不上。
    expect(localizeNewConditionCase(t, source).id).toBe('case-1')
  })

  it('新增控制项名称按当前界面语言写入', () => {
    const source = { id: 'ctl-1', key: 'switch-1', label: 'Switch 1' }
    expect(localizeNewControlItem(t, source)).toEqual({ id: 'ctl-1', key: 'switch-1', label: '功能开关' })
  })

  it('英文界面写入英文文案', () => {
    const en = createAppTranslator('en')
    expect(localizeNewConditionCase(en, { name: '' }).name).toBe('Branch 1')
    expect(localizeNewControlItem(en, { label: '' }).label).toBe('Feature switch')
  })
})

describe('固定节点判定', () => {
  const position = { x: 0, y: 0 }

  it('入口与出口是固定节点：不可删、不可改名', () => {
    expect(isProtectedNode(createInputNode(position))).toBe(true)
    expect(isProtectedNode(createOutputNode(position))).toBe(true)
  })

  it('其余节点都可以自由增删', () => {
    for (const kind of APPENDABLE_KINDS) {
      expect(isProtectedNode(createNodeByKind(kind, position)), kind).toBe(false)
    }
  })
})

describe('便签尺寸回落', () => {
  const position = { x: 0, y: 0 }

  it('旧数据没有 size 时回落到默认宽高', () => {
    const note = createNoteNode(position)
    expect(resolveNoteNodeSize({ ...note, size: undefined })).toEqual({ width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT })
  })

  it('已存下的尺寸原样返回，包括被拖到很小的值', () => {
    const note = createNoteNode(position)
    expect(resolveNoteNodeSize({ ...note, size: { width: 400, height: 260 } })).toEqual({ width: 400, height: 260 })
    // 这里不做下限钳制：钳制发生在拖拽那一步，读取侧照实回放图里存的数。
    expect(resolveNoteNodeSize({ ...note, size: { width: 10, height: 10 } })).toEqual({ width: 10, height: 10 })
  })
})

describe('连线颜色', () => {
  it('协议发现按端口分色，未识别协议走警示色', () => {
    expect(edgeStrokeColor('protocol-discovery', 'unknown')).toBe('var(--color-text-warning)')
    expect(edgeStrokeColor('protocol-discovery', 'openai-completions')).toBe('var(--color-util-colors-cyan-cyan-500)')
  })

  // ELSE 分支是“其余情况”，用中性灰；真分支才上绿色。
  it('条件的 ELSE 端口用中性灰，其余分支用分支色', () => {
    expect(edgeStrokeColor('condition', 'else')).toBe(EDGE_STROKE_NORMAL)
    expect(edgeStrokeColor('condition', 'case-1')).toBe('var(--color-util-colors-green-green-500)')
  })

  // 迭代只有循环体那根线是“回路”色，出口线要和普通连线一样灰。
  it('迭代只给 body 端口上回路色，出口线保持中性灰', () => {
    expect(edgeStrokeColor('iteration', 'body')).toBe('var(--color-util-colors-violet-violet-500)')
    expect(edgeStrokeColor('iteration', 'out')).toBe(EDGE_STROKE_NORMAL)
  })

  it('按来源节点种类着色', () => {
    expect(edgeStrokeColor('model-select', 'out')).toBe('var(--color-util-colors-indigo-indigo-500)')
    expect(edgeStrokeColor('control-input', 'out')).toBe('var(--color-util-colors-blue-blue-500)')
    expect(edgeStrokeColor('script', 'out')).toBe('var(--color-util-colors-yellow-yellow-500)')
    expect(edgeStrokeColor('prompt', 'out')).toBe('var(--color-util-colors-pink-pink-500)')
  })

  it('入口与出口这类无分支语义的节点用中性灰', () => {
    expect(edgeStrokeColor('input', 'out')).toBe(EDGE_STROKE_NORMAL)
    expect(edgeStrokeColor('output', 'out')).toBe(EDGE_STROKE_NORMAL)
    expect(edgeStrokeColor('note', 'out')).toBe(EDGE_STROKE_NORMAL)
  })

  it('运行态颜色只覆盖三种终态，未运行过交给分支色', () => {
    expect(edgeRunStatusStroke('succeeded')).toBe('var(--color-workflow-link-line-success-handle)')
    expect(edgeRunStatusStroke('failed')).toBe('var(--color-workflow-link-line-error-handle)')
    expect(edgeRunStatusStroke('running')).toBe('var(--color-workflow-link-line-handle)')
    // idle / undefined 都不着色，调用方回落到 `edgeStrokeColor`。
    expect(edgeRunStatusStroke('idle')).toBeUndefined()
    expect(edgeRunStatusStroke(undefined)).toBeUndefined()
  })

  it('两种连线常量就是上游那两个 CSS 变量', () => {
    expect(EDGE_STROKE_NORMAL).toBe('var(--color-workflow-link-line-normal)')
    expect(EDGE_STROKE_HANDLE).toBe('var(--color-workflow-link-line-handle)')
  })
})
