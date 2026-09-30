import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultPolicyGraph, isSameGraph } from '@common/router/presets'
import { UNSAVED_ROUTER_GRAPH_VERSION } from '@common/router/types'
import type { RuntimeLogicalModel, WorkflowGraph } from '@common/router/types'
import { closeDatabases, initDatabases } from './index'
import { listLogicalModels } from './logical-model-store'
import {
  MAX_ROUTER_GRAPH_VERSIONS,
  listRouterGraphVersions,
  readRouterGraphSnapshot,
  readRouterGraphVersion,
  resolveRouterGraph,
  saveRouterGraphVersion,
} from './router-graph-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabases()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

async function initTemporaryDatabase(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-router-graph-'))
  temporaryDirectories.push(directory)
  await initDatabases(directory)
}

async function createModels(): Promise<RuntimeLogicalModel[]> {
  // 内建默认逻辑模型由 `initDatabases` 落库，这里不重复创建它（活跃行的 `modelId` 上是唯一索引）。
  const seeded = await listLogicalModels()
  return seeded.map(model => ({ modelId: model.modelId, enabled: model.enabled }))
}

/** 造一张与基准图不同的图：只改节点名，结构仍然合法。 */
function graphWithMarker(marker: string): WorkflowGraph {
  const base = createDefaultPolicyGraph([])
  return { ...base, nodes: base.nodes.map(node => ({ ...node, name: `${marker}${node.name}` })) }
}

describe('router graph store', () => {
  it('falls back to the built-in default policy when nothing has been saved', async () => {
    await initTemporaryDatabase()
    const models = await createModels()

    const snapshot = await resolveRouterGraph()

    expect(snapshot.version).toBe(UNSAVED_ROUTER_GRAPH_VERSION)
    expect(snapshot.savedAt).toBe(0)
    expect(isSameGraph(snapshot.graph, createDefaultPolicyGraph(models))).toBe(true)
    expect(await readRouterGraphSnapshot()).toBeNull()
    expect(await listRouterGraphVersions()).toEqual([])
  })

  it('saves a version, reads it back, and keeps version numbers monotonic', async () => {
    await initTemporaryDatabase()
    const first = graphWithMarker('v1-')
    const second = graphWithMarker('v2-')

    const savedFirst = await saveRouterGraphVersion(first, '第一版', '先把 UA 分流出来')
    const savedSecond = await saveRouterGraphVersion(second, '第二版', undefined)

    expect(savedFirst).toMatchObject({ version: 1, name: '第一版', description: '先把 UA 分流出来', created: true })
    // 没写说明时落库是空串，而不是 undefined：列表层才能一律当字符串处理。
    expect(savedSecond).toMatchObject({ version: 2, name: '第二版', description: '', created: true })
    expect(savedFirst.nodeCount).toBe(first.nodes.length)

    // 名单里的名字与说明要能回读到版本列表，用户下次翻开才能认出哪一版是哪一版。
    const summaries = await listRouterGraphVersions()
    expect(summaries.map(summary => [summary.version, summary.name, summary.description])).toEqual([
      [2, '第二版', ''],
      [1, '第一版', '先把 UA 分流出来'],
    ])

    const snapshot = await readRouterGraphSnapshot()
    expect(snapshot?.version).toBe(2)
    expect(snapshot?.graph && isSameGraph(snapshot.graph, second)).toBe(true)

    const restored = await readRouterGraphVersion(1)
    expect(restored?.version).toBe(1)
    expect(restored?.graph && isSameGraph(restored.graph, first)).toBe(true)
    expect(await readRouterGraphVersion(9)).toBeNull()

    expect((await resolveRouterGraph()).version).toBe(2)
  })

  it('版本号是版本的身份，名字重复不阻止新版本', async () => {
    await initTemporaryDatabase()

    const first = await saveRouterGraphVersion(graphWithMarker('a-'), '按来源分流', '先把 UA 分流出来')
    const second = await saveRouterGraphVersion(graphWithMarker('b-'), '按来源分流', '再补一条分支')

    // 名字不承担唯一性：两版同名，靠版本号区分。
    expect(first).toMatchObject({ version: 1, name: '按来源分流', created: true })
    expect(second).toMatchObject({ version: 2, name: '按来源分流', created: true })
    expect((await listRouterGraphVersions()).map(summary => [summary.version, summary.name])).toEqual([
      [2, '按来源分流'],
      [1, '按来源分流'],
    ])
  })

  it('没起名字就存空串，不拿版本号去占位', async () => {
    await initTemporaryDatabase()

    const saved = await saveRouterGraphVersion(graphWithMarker('anon-'), undefined, undefined)

    // 版本号有自己的字段（`version`），名字里不该再抄一份 `Version 1`。
    expect(saved).toMatchObject({ version: 1, name: '', description: '', created: true })
    expect((await listRouterGraphVersions())[0].name).toBe('')
  })

  it('does not create a version when the content equals the latest one', async () => {
    await initTemporaryDatabase()
    const graph = graphWithMarker('same-')

    await saveRouterGraphVersion(graph, undefined, undefined)
    const repeated = await saveRouterGraphVersion(graph, '改了名字但内容没变', '这段说明不应该落库')

    expect(repeated).toMatchObject({ version: 1, created: false })
    expect(await listRouterGraphVersions()).toHaveLength(1)
    // 没有新版本，就没有地方安放这一版的说明：它描述的是「这一次改动」，而这次并没有改动。
    expect(repeated.description).toBe('')
  })

  it('archives the oldest versions beyond the retention limit', async () => {
    await initTemporaryDatabase()

    for (let index = 1; index <= MAX_ROUTER_GRAPH_VERSIONS + 3; index += 1) {
      await saveRouterGraphVersion(graphWithMarker(`v${index}-`), undefined, undefined)
    }

    const versions = await listRouterGraphVersions()
    expect(versions).toHaveLength(MAX_ROUTER_GRAPH_VERSIONS)
    // 新的在前往前，最旧的三版已经不再出现在列表里，也读不回来。
    expect(versions[0].version).toBe(MAX_ROUTER_GRAPH_VERSIONS + 3)
    expect(await readRouterGraphVersion(1)).toBeNull()
    expect(await readRouterGraphVersion(4)).not.toBeNull()
    // 被裁掉的旧版本不能把版本号一起带走：它们的行还在库里，若唯一索引是全表的那一条，
    // 下一个版本号就会撞上这些历史行。活跃行之间唯一才是对的（partial index）。
    const saved = await saveRouterGraphVersion(graphWithMarker('after-prune-'), undefined, undefined)
    expect(saved).toMatchObject({ version: MAX_ROUTER_GRAPH_VERSIONS + 4, created: true })
    expect((await listRouterGraphVersions())[0].version).toBe(MAX_ROUTER_GRAPH_VERSIONS + 4)
  })

  it('skips stored rows whose definition is not a valid graph', async () => {
    await initTemporaryDatabase()
    const graph = graphWithMarker('ok-')
    await saveRouterGraphVersion(graph, undefined, undefined)

    const { createWorkflow } = await import('./workflow-store')
    await createWorkflow({ type: 'router', version: 2, name: '损坏的版本', description: '', definition: { version: 1, nodes: 'not-an-array' } })

    const versions = await listRouterGraphVersions()
    expect(versions.map(version => version.version)).toEqual([1])
    // 最新一版损坏时不能把整个读取拖下水：退回上一版可解析的图。
    expect((await readRouterGraphSnapshot())?.version).toBe(1)
  })
})
