import { describe, expect, it } from 'vitest'
import type { WorkflowNodeModel, WorkflowRunResult, WorkflowTrace } from '@common/router/types'
import { buildRunStatusByNode, formatNodeOutputValue, groupNodeOutputs } from './node-output'

/**
 * 试运行结果的两条读法：节点状态取自 trace 的最后一条，输出值的排版按类型分三档。
 * 这两条以前长在路由页的画布里，只能靠跑一次测试再看界面验证。
 */

function node(id: string, name: string): WorkflowNodeModel {
  return {
    id,
    kind: 'script',
    name,
    position: { x: 0, y: 0 },
    config: {},
  } as unknown as WorkflowNodeModel
}

function trace(nodeId: string, nodeName: string, success: boolean): WorkflowTrace {
  return { nodeId, nodeName, kind: 'script', success, message: '' }
}

function runResult(overrides: Partial<WorkflowRunResult>): WorkflowRunResult {
  return {
    outputPayload: null,
    protocol: 'openai-completions',
    nodeOutputs: {},
    stopReason: 'output',
    trace: [],
    ...overrides,
  }
}

describe('formatNodeOutputValue', () => {
  it('没有值与空串都写 —（「没说」和「空字符串」在界面上是同一件事）', () => {
    expect(formatNodeOutputValue(null)).toBe('—')
    expect(formatNodeOutputValue(undefined)).toBe('—')
    expect(formatNodeOutputValue('')).toBe('—')
    expect(formatNodeOutputValue([])).toBe('—')
  })

  it('字符串与数字 / 布尔直出', () => {
    expect(formatNodeOutputValue('gpt-4o')).toBe('gpt-4o')
    expect(formatNodeOutputValue(0)).toBe('0')
    expect(formatNodeOutputValue(false)).toBe('false')
  })

  it('数组用逗号连接，非字符串元素走 JSON', () => {
    expect(formatNodeOutputValue(['a', 'b'])).toEqual('a, b')
    expect(formatNodeOutputValue([1, { a: 1 }])).toEqual('1, {"a":1}')
  })

  it('普通对象走 JSON', () => {
    expect(formatNodeOutputValue({ modelId: 'fast' })).toEqual('{"modelId":"fast"}')
  })
})

describe('buildRunStatusByNode', () => {
  it('没有运行结果时全是空闲', () => {
    expect(buildRunStatusByNode(null).size).toBe(0)
  })

  it('成功与失败分别标成 succeeded / failed', () => {
    const map = buildRunStatusByNode(runResult({
      trace: [
        trace('a', 'A', true),
        trace('b', 'B', false),
      ],
    }))
    expect(map.get('a')).toBe('succeeded')
    expect(map.get('b')).toBe('failed')
  })

  it('同一节点出现多条时以最后一条为准（trace 按执行顺序追加）', () => {
    const map = buildRunStatusByNode(runResult({ trace: [trace('a', 'A', true), trace('a', 'A', false)] }))
    expect(map.get('a')).toBe('failed')
  })
})

describe('groupNodeOutputs', () => {
  it('把节点 id 翻译成画布上的节点名', () => {
    const groups = groupNodeOutputs([node('a', '改写请求'), node('b', '出口')], runResult({
      nodeOutputs: { a: [{ name: 'modelId', value: 'fast' }], b: [] },
    }))
    expect(groups).toEqual([
      { nodeId: 'a', nodeName: '改写请求', outputs: [{ name: 'modelId', value: 'fast' }] },
      { nodeId: 'b', nodeName: '出口', outputs: [] },
    ])
  })

  it('图里已经找不到这个节点时退回 id，不留空标题', () => {
    const groups = groupNodeOutputs([], runResult({ nodeOutputs: { gone: [{ name: 'x', value: 1 }] } }))
    expect(groups[0].nodeName).toBe('gone')
  })

  it('还没跑过时没有分组', () => {
    expect(groupNodeOutputs([node('a', 'A')], null)).toEqual([])
  })
})
