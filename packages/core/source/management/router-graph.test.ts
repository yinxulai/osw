import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankGraph, createDefaultPolicyGraph, samplePayload } from '@common/router/presets'
import { UNSAVED_ROUTER_GRAPH_VERSION } from '@common/router/types'
import type { RuntimeLogicalModel, WorkflowGraph } from '@common/router/types'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { routerGraphRoutes } from './routes/router/graph'
import { routerRunRoutes } from './routes/router/run'
import { mockResponse } from './test-support'

/**
 * 路由图读写与试跑接口。
 *
 * 这里只验证「接口把仓储的语义原样透出去」（未保存时给内建默认图、重复保存不产生新版本、
 * 读不到给 `null`）；图本身的构造与执行分别是 `presets.test.ts` / `route-rule-engine.test.ts` 的事。
 */

const models: RuntimeLogicalModel[] = [{ id: 'default', name: 'Default', enabled: true }]

/** 试跑也会真的跑一遍引擎，所以「跑过哪些节点」同样是产品事实，要按同一口径埋点。 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

let temporaryDirectory: string

function responseData(response: ServerResponse): unknown {
  const raw = vi.mocked(response.end).mock.calls[0][0] as string
  return JSON.parse(raw).data
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-router-graph-'))
  await initDatabases(temporaryDirectory)
  reported.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('router graph routes', () => {
  it('一版都没保存过时返回内建默认图，版本号是「未保存」', async () => {
    const response = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph', response)

    const snapshot = responseData(response) as { graph: WorkflowGraph; version: number; savedAt: number }
    expect(snapshot.version).toBe(UNSAVED_ROUTER_GRAPH_VERSION)
    expect(snapshot.savedAt).toBe(0)
    expect(snapshot.graph.nodes.length).toBeGreaterThan(0)
  })

  it('保存后版本列表与按版本读取都能拿到同一张图', async () => {
    const graph = createDefaultPolicyGraph(models)
    const saveResponse = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/save', saveResponse, {
      graph,
      name: '  第一版  ',
      description: '  说明  ',
    })

    const saved = responseData(saveResponse) as { version: number; created: boolean; name: string; description: string }
    expect(saved).toMatchObject({ version: 1, created: true, name: '第一版', description: '说明' })

    const listResponse = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/versions', listResponse)
    expect(responseData(listResponse)).toEqual([
      expect.objectContaining({ version: 1, name: '第一版', nodeCount: graph.nodes.length }),
    ])

    const readResponse = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/version', readResponse, { version: 1 })
    expect(responseData(readResponse)).toMatchObject({ version: 1, graph })

    const currentResponse = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph', currentResponse)
    expect(responseData(currentResponse)).toMatchObject({ version: 1, graph })
  })

  it('内容没变时不再新增版本，并丢弃本次填写的名字与说明', async () => {
    const graph = createDefaultPolicyGraph(models)
    await routerGraphRoutes.invoke('/api/router/graph/save', mockResponse(), { graph, name: '第一版' })

    const again = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/save', again, { graph, name: '第二版' })
    expect(responseData(again)).toMatchObject({ version: 1, created: false, name: '第一版' })

    const listResponse = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/versions', listResponse)
    expect(responseData(listResponse)).toHaveLength(1)
  })

  it('内容变化时版本号递增，名字与说明可以留空', async () => {
    await routerGraphRoutes.invoke('/api/router/graph/save', mockResponse(), { graph: createDefaultPolicyGraph(models) })

    const changed = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/save', changed, { graph: createBlankGraph() })
    expect(responseData(changed)).toMatchObject({ version: 2, created: true, name: '', description: '' })
  })

  it('读取不存在的版本得到 null，而不是报错', async () => {
    const response = mockResponse()
    await routerGraphRoutes.invoke('/api/router/graph/version', response, { version: 99 })
    expect(responseData(response)).toBeNull()
  })
})

describe('router run route', () => {
  it('执行给定图并回传结果', async () => {
    const response = mockResponse()
    await routerRunRoutes.invoke('/api/router/run', response, {
      graph: createDefaultPolicyGraph(models),
      inputPayload: samplePayload,
    })

    const result = responseData(response) as { stopReason: string; nodeOutputs: Record<string, unknown>; trace: Array<{ kind: string }> } | null
    expect(result).not.toBeNull()
    expect(result!.stopReason).not.toBe('error')
    expect(typeof result!.nodeOutputs).toBe('object')
    expect(Array.isArray(result!.trace)).toBe(true)

    // 轨迹里的每个节点各一条，且类型对得上——埋点不能只报「跑过图」这个事实。
    expect(reported).toEqual(result!.trace.map(step => ({ name: 'workflow_node_executed', node_kind: step.kind })))
  })

  it('图不合法时拒绝执行', async () => {
    await expect(routerRunRoutes.invoke('/api/router/run', mockResponse(), {
      graph: { version: 2, nodes: [], edges: [] },
      inputPayload: { request: { method: 'POST', path: '/v1/chat/completions' } },
    })).rejects.toThrow()
  })
})
