// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import type { WorkflowGraph, WorkflowNodeModel } from '@common/router/types'
import { I18nProvider } from '@/i18n/provider'
import { resolveInputHints } from '../field-hints'
import { InputPanel } from './input-panel'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const position = { x: 0, y: 0 }
const inputNode: WorkflowNodeModel = { id: 'input', kind: 'input', name: '输入请求', enabled: true, description: '', position }
const targetNode: WorkflowNodeModel = { id: 'target', kind: 'condition', name: '条件', enabled: true, description: '', position, cases: [] }
const graph: WorkflowGraph = {
  version: 1,
  nodes: [inputNode, targetNode],
  edges: [{ id: 'input:out->target', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'target' }],
}

function renderPanel() {
  return render(
    <InputPanel
      model={inputNode}
      update={() => {}}
      nodeModels={graph.nodes}
      logicalModels={[]}
      conditionFieldHints={[]}
    />,
    { wrapper: I18nProvider },
  )
}

describe('InputPanel', () => {
  it('逐条列出输入节点声明的字段，与字段候选表同源同序', () => {
    // 面板与候选表是同一份清单的两个出口：面板上读到的路径必须正好是
    // `resolveInputHints` 交给下游条件节点的那些，多一条（下游选不到）或少一条
    // （下游能选但界面上看不见）都算漂移。
    const declared = resolveInputHints(createAppTranslator('zh-CN'), graph, 'target').fields
      .filter(field => field.sourceNodeId === 'input')
      .map(field => field.path)

    const view = renderPanel()
    const shown = [...view.container.querySelectorAll('span.font-mono')].map(span => span.textContent)

    expect(declared.length).toBeGreaterThan(0)
    expect(shown).toEqual(declared)
  })

  it('不列协议层的字段：请求体里有什么由协议发现节点交给下游', () => {
    const text = renderPanel().container.textContent ?? ''

    expect(text).toContain('request.body')
    expect(text).not.toContain('request.body.model')
    expect(text).not.toContain('request.body.messages')
    expect(text).not.toContain('request.body.input')
    expect(text).not.toContain('route.protocol')
  })
})
