import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowTrace } from '@common/router/types'
import type { TelemetryEventInput } from '@common/telemetry'
import { reportWorkflowTrace } from './events'

/**
 * 工作流有两条执行路径（代理里的路由求解与画布上的试跑），两条都要按同一口径埋点。
 * 粒度是「节点被执行过一次就发一条」，所以这里要盯住的是**条数与节点类型一一对应**，
 * 而不是某一条长什么样。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('./index', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

function trace(kind: WorkflowTrace['kind'], index: number): WorkflowTrace {
  return { nodeId: `node-${index}`, nodeName: `节点 ${index}`, kind, success: true, message: '' }
}

beforeEach(() => {
  reported.length = 0
})

describe('reportWorkflowTrace', () => {
  it('reports one event per executed node, in execution order', () => {
    reportWorkflowTrace([trace('input', 0), trace('condition', 1), trace('output', 2)])

    expect(reported).toEqual([
      { name: 'workflow_node_executed', node_kind: 'input' },
      { name: 'workflow_node_executed', node_kind: 'condition' },
      { name: 'workflow_node_executed', node_kind: 'output' },
    ])
  })

  it('reports nothing for an empty trace', () => {
    reportWorkflowTrace([])

    expect(reported).toEqual([])
  })

  it('skips steps that never ran: 禁用而跳过的节点与缺输入节点时的占位', () => {
    reportWorkflowTrace([
      trace('input', 0),
      { ...trace('condition', 1), executed: false, message: '节点禁用，跳过' },
      { ...trace('input', 2), nodeId: '-', executed: false, success: false, message: '缺少输入节点' },
      trace('output', 3),
    ])

    // 两个被滤掉的步骤里有一个与首条同为 `input`：过滤看的是 `executed`，不是节点类型。
    expect(reported).toEqual([
      { name: 'workflow_node_executed', node_kind: 'input' },
      { name: 'workflow_node_executed', node_kind: 'output' },
    ])
  })
})
