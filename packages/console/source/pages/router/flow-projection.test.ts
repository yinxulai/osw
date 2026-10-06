import { describe, expect, it, vi } from 'vitest'
import type { WorkflowEdge, WorkflowGraph, WorkflowNodeKind, WorkflowNodeModel } from '@common/router/types'
import { NODE_KIND_ORDER, EDGE_STROKE_NORMAL } from './node-meta'
import { buildFlowEdges, layoutRouterNodes } from './flow-projection'

/** 布局只读 id / kind / position，其余字段与这两条断言无关。 */
function node(id: string, kind: WorkflowNodeKind, x: number, y: number): WorkflowNodeModel {
  return { id, kind, name: id, enabled: true, description: '', position: { x, y } } as unknown as WorkflowNodeModel
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, sourcePort = 'out'): WorkflowEdge {
  return { id, sourceNodeId, sourcePort, targetNodeId }
}

function graph(nodes: WorkflowNodeModel[], edges: WorkflowEdge[] = []): WorkflowGraph {
  return { version: 1, nodes, edges }
}

describe('layoutRouterNodes', () => {
  it('只有一个节点时不动它', () => {
    const nodes = [node('a', 'input', 0, 0)]
    expect(layoutRouterNodes(nodes)).toBe(nodes)
  })

  // 用户自己排好的版不能被覆盖：坐标已经散开时原样返回。
  it('坐标本来就散开时保持用户排版', () => {
    const nodes = [node('a', 'input', 0, 0), node('b', 'output', 900, 700)]
    expect(layoutRouterNodes(nodes)).toBe(nodes)
  })

  // 旧数据（或空白数据）的节点会全部落在同一个点上，那时才按类型做列式布局。
  it('坐标聚成一团时按类型分列重排', () => {
    const nodes = [
      node('in', 'input', 0, 0),
      node('c1', 'condition', 0, 0),
      node('c2', 'condition', 0, 0),
      node('out', 'output', 0, 0),
    ]
    const laid = layoutRouterNodes(nodes)
    const at = (id: string) => laid.find(item => item.id === id)!.position

    // 列位置由 `NODE_KIND_ORDER` 决定：input 第 0 列、condition 第 3 列、output 第 8 列。
    expect(NODE_KIND_ORDER.indexOf('input')).toBe(0)
    expect(at('in')).toEqual({ x: 80, y: 200 })
    expect(at('c1')).toEqual({ x: 80 + 3 * 340, y: 200 })
    // 同类型在同一列里逐行往下排，且顺序按传入顺序 —— 没人希望重排把两条分支对调。
    expect(at('c2')).toEqual({ x: 80 + 3 * 340, y: 400 })
    expect(at('out')).toEqual({ x: 80 + 8 * 340, y: 200 })
  })

  it('重排只改坐标，其余字段原样保留', () => {
    const nodes = [node('a', 'input', 0, 0), node('b', 'note', 10, 10)]
    const [first] = layoutRouterNodes(nodes)
    expect(first).toMatchObject({ id: 'a', kind: 'input', name: 'a', enabled: true })
  })
})

describe('buildFlowEdges', () => {
  it('端口用显式 id 传递，箭头画在终点', () => {
    const [flowEdge] = buildFlowEdges(
      graph([node('in', 'input', 0, 0), node('out', 'output', 0, 0)], [edge('e1', 'in', 'out', 'body')]),
    )
    expect(flowEdge).toMatchObject({
      id: 'e1',
      type: 'workflow',
      source: 'in',
      sourceHandle: 'body',
      target: 'out',
      targetHandle: 'target',
    })
  })

  // 箭头在终点，所以它跟的是**下游**状态：一条线接进失败的节点，
  // 箭头必须跟着变红，否则「哪一段出错了」在画布上读不出来。
  it('箭头颜色跟随下游运行状态，未运行时回落到分支色', () => {
    const nodes = [node('in', 'input', 0, 0), node('out', 'output', 0, 0)]
    const strokes = (status: 'idle' | 'running' | 'succeeded' | 'failed') => {
      const statuses = new Map<string, 'idle' | 'running' | 'succeeded' | 'failed'>([['out', status]])
      const [flowEdge] = buildFlowEdges(graph(nodes, [edge('e1', 'in', 'out')]), { runStatusByNode: statuses })
      return {
        marker: flowEdge.markerEnd,
        data: flowEdge.data,
      }
    }

    expect(strokes('idle').marker).toMatchObject({ color: EDGE_STROKE_NORMAL })
    expect(strokes('running').marker).toMatchObject({ color: 'var(--color-workflow-link-line-handle)' })
    expect(strokes('succeeded').marker).toMatchObject({ color: 'var(--color-workflow-link-line-success-handle)' })
    expect(strokes('failed').marker).toMatchObject({ color: 'var(--color-workflow-link-line-error-handle)' })

    // 连线本身保留分支色，状态只体现在箭头与渐变上。
    expect(strokes('failed').data).toMatchObject({
      sourceRunStatus: 'idle',
      targetRunStatus: 'failed',
      stroke: EDGE_STROKE_NORMAL,
    })
  })

  it('分支色按上游节点的类型与端口区分', () => {
    const nodes = [node('cond', 'condition', 0, 0), node('out', 'output', 0, 0)]
    const strokeOf = (port: string) => buildFlowEdges(graph(nodes, [edge('e', 'cond', 'out', port)]))[0]!.data!.stroke
    expect(strokeOf('else')).toBe(EDGE_STROKE_NORMAL)
    expect(strokeOf('out')).toBe('var(--color-util-colors-green-green-500)')
  })

  // 找不到上游节点时按 `input` 处理：宁可画成默认灰，也不要抛错让整张画布打不开。
  it('上游节点缺失时退化成默认分支色', () => {
    const nodes = [node('out', 'output', 0, 0)]
    const [flowEdge] = buildFlowEdges(graph(nodes, [edge('e', 'ghost', 'out')]))
    expect(flowEdge.data).toMatchObject({ sourceKind: 'input', stroke: EDGE_STROKE_NORMAL })
  })

  it('任意一端被禁用时整条线降透明度', () => {
    const nodes = [node('in', 'input', 0, 0), { ...node('out', 'output', 0, 0), enabled: false }]
    const [flowEdge] = buildFlowEdges(graph(nodes, [edge('e', 'in', 'out')]))
    expect(flowEdge.data!.dimmed).toBe(true)
  })

  it('两端都启用时不降透明度', () => {
    const nodes = [node('in', 'input', 0, 0), node('out', 'output', 0, 0)]
    expect(buildFlowEdges(graph(nodes, [edge('e', 'in', 'out')]))[0]!.data!.dimmed).toBe(false)
  })

  // 出口之后没有下游，在它后面插节点没有意义，所以只有出口节点的出边不给插入。
  it('只有出口节点的出边不允许插入节点', () => {
    const nodes = [node('in', 'input', 0, 0), node('out', 'output', 0, 0), node('script', 'script', 0, 0)]
    const edges = [edge('e1', 'in', 'script'), edge('e2', 'script', 'out'), edge('e3', 'out', 'in')]
    const built = buildFlowEdges(graph(nodes, edges))
    expect(built.map(item => item.data!.canInsert)).toEqual([true, true, false])
  })

  it('只高亮与悬浮节点相连的线，没有悬浮时全不高亮', () => {
    const nodes = [node('a', 'input', 0, 0), node('b', 'condition', 0, 0), node('c', 'output', 0, 0)]
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')]

    expect(buildFlowEdges(graph(nodes, edges)).map(item => item.data!.highlighted)).toEqual([false, false])
    expect(buildFlowEdges(graph(nodes, edges), { hoveredNodeId: 'b' }).map(item => item.data!.highlighted))
      .toEqual([true, true])
    // 悬浮在端点上也一样，两端任意一端命中就算。
    expect(buildFlowEdges(graph(nodes, edges), { hoveredNodeId: 'a' }).map(item => item.data!.highlighted))
      .toEqual([true, false])
  })

  it('把插入回调原样挂在每条边上', () => {
    const nodes = [node('in', 'input', 0, 0), node('out', 'output', 0, 0)]
    const onInsert = vi.fn()
    const built = buildFlowEdges(graph(nodes, [edge('e', 'in', 'out')]), { onInsert })
    expect(built[0]!.data!.onInsert).toBe(onInsert)
  })
})
