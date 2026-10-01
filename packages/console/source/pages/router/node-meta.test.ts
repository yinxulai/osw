import { describe, expect, it } from 'vitest'

import { createAppTranslator } from '@common/i18n/catalogs'
import {
  ROUTER_POLICY_PRESETS,
  createDefaultPolicyGraph,
  createNodeByKind,
} from '@common/router/presets'
import type { RuntimeLogicalModel } from '@common/router/types'
import { displayWorkflowNode, localizeNewNode } from './node-meta'

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
