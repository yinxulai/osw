import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultRouteRuleSet,
  isSameRouteRuleSet,
  MAX_ROUTE_RULE_VERSIONS,
  UNSAVED_ROUTE_RULE_VERSION,
} from '@common/router/route-rules'
import type { RouteRuleSet } from '@common/router/route-rules'
import type { RuntimeLogicalModel } from '@common/router/types'
import { closeDatabases, initDatabases } from './index'
import { listLogicalModels } from './logical-model-store'
import {
  ROUTE_RULE_TYPE,
  listRouteRuleSetVersions,
  readRouteRuleSetVersion,
  readRouteRuleSnapshot,
  resolveRouteRuleSet,
  saveRouteRuleSetVersion,
} from './route-rule-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabases()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

async function initTemporaryDatabase(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-route-rules-'))
  temporaryDirectories.push(directory)
  await initDatabases(directory)
}

async function createModels(): Promise<RuntimeLogicalModel[]> {
  // 内建默认逻辑模型由 `initDatabases` 落库，这里不重复创建它（活跃行的 `modelId` 上是唯一索引）。
  const seeded = await listLogicalModels()
  return seeded.map(model => ({ modelId: model.modelId, enabled: model.enabled }))
}

/** 造一份与基准规则表不同的表：只改规则名，结构仍然合法。 */
function ruleSetWithMarker(marker: string): RouteRuleSet {
  const base = createDefaultRouteRuleSet([])
  return { ...base, rules: base.rules.map(rule => ({ ...rule, name: `${marker}${rule.name}` })) }
}

async function countRows(): Promise<number> {
  const { listWorkflows } = await import('./workflow-store')
  return (await listWorkflows()).filter(record => record.type === ROUTE_RULE_TYPE).length
}

describe('route rule store', () => {
  it('一版都没保存过时给出内建默认表', async () => {
    await initTemporaryDatabase()
    const models = await createModels()

    const snapshot = await resolveRouteRuleSet()

    expect(snapshot.version).toBe(UNSAVED_ROUTE_RULE_VERSION)
    expect(snapshot.savedAt).toBe(0)
    expect(isSameRouteRuleSet(snapshot.ruleSet, createDefaultRouteRuleSet(models))).toBe(true)
    expect(await readRouteRuleSnapshot()).toBeNull()
    expect(await listRouteRuleSetVersions()).toEqual([])
  })

  it('每保存一次生成一个新版本，代理读的是最近保存的那一版', async () => {
    await initTemporaryDatabase()

    const first = await saveRouteRuleSetVersion(ruleSetWithMarker('v1-'), '  第一版  ', '  刚建出来  ')
    expect(first).toMatchObject({ version: 1, created: true, name: '第一版', description: '刚建出来' })
    expect(first.ruleCount).toBe(createDefaultRouteRuleSet([]).rules.length)

    const second = await saveRouteRuleSetVersion(ruleSetWithMarker('v2-'), '第二版', undefined)
    expect(second).toMatchObject({ version: 2, created: true, name: '第二版', description: '' })

    // 版本列表新的在前，两个版本都在（保存不是原地改写）。
    const versions = await listRouteRuleSetVersions()
    expect(versions.map(summary => summary.version)).toEqual([2, 1])
    expect(versions.map(summary => summary.name)).toEqual(['第二版', '第一版'])
    expect(await countRows()).toBe(2)

    // 代理此刻执行的是第二版，旧版仍然可按版本号取回来。
    const resolved = await resolveRouteRuleSet()
    expect(resolved.version).toBe(2)
    expect(isSameRouteRuleSet(resolved.ruleSet, ruleSetWithMarker('v2-'))).toBe(true)

    const rolledBack = await readRouteRuleSetVersion(1)
    expect(rolledBack?.version).toBe(1)
    expect(isSameRouteRuleSet(rolledBack!.ruleSet, ruleSetWithMarker('v1-'))).toBe(true)
    expect(await readRouteRuleSetVersion(99)).toBeNull()
  })

  it('内容与最新版一致时不再新增版本，名字与说明一并丢弃', async () => {
    await initTemporaryDatabase()

    await saveRouteRuleSetVersion(ruleSetWithMarker('same-'), '第一版', '')
    const again = await saveRouteRuleSetVersion(ruleSetWithMarker('same-'), '想再存一版', '但是什么都没改')

    expect(again).toMatchObject({ version: 1, created: false })
    // 连上一次填的名字都不能被覆盖：它描述的是「那一次改动」，而这次并没有改动可描述。
    expect((await listRouteRuleSetVersions()).map(summary => summary.name)).toEqual(['第一版'])
    expect(await countRows()).toBe(1)
  })

  it('名字可以留空：版本的身份是版本号，不是名字', async () => {
    await initTemporaryDatabase()

    const saved = await saveRouteRuleSetVersion(ruleSetWithMarker('anon-'), undefined, undefined)

    expect(saved).toMatchObject({ version: 1, created: true, name: '', description: '' })
    // 名字空着也要能载回来：它是这一版的内容，不是它的标识。
    expect(isSameRouteRuleSet((await readRouteRuleSetVersion(1))!.ruleSet, ruleSetWithMarker('anon-'))).toBe(true)
  })

  it('与路由图共用同一张表，但双方各写各的行、各算各的版本号', async () => {
    await initTemporaryDatabase()
    const { saveRouterGraphVersion, listRouterGraphVersions, resolveRouterGraph } = await import('./router-graph-store')
    const { createDefaultPolicyGraph } = await import('@common/router/presets')
    // 造一张与基准图不同的图：只改节点名，免得「内容没变」被当成重复保存而拒掉。
    const graphWithMarker = (marker: string) => {
      const base = createDefaultPolicyGraph([])
      return { ...base, nodes: base.nodes.map(node => ({ ...node, name: `${marker}${node.name}` })) }
    }

    await saveRouterGraphVersion(graphWithMarker('g1-'), '图第一版', undefined)
    await saveRouterGraphVersion(graphWithMarker('g2-'), '图第二版', undefined)
    await saveRouteRuleSetVersion(ruleSetWithMarker('r1-'), '表第一版', undefined)

    // 两边都从 1 开始、各存自己的版本：两种定义谁也推不动谁。
    expect((await listRouterGraphVersions()).map(summary => summary.version)).toEqual([2, 1])
    expect((await resolveRouterGraph()).version).toBe(2)
    expect((await listRouteRuleSetVersions()).map(summary => summary.version)).toEqual([1])
    expect((await resolveRouteRuleSet()).version).toBe(1)
    expect(isSameRouteRuleSet((await resolveRouteRuleSet()).ruleSet, ruleSetWithMarker('r1-'))).toBe(true)
  })

  it('跳过内容损坏的行，不和图的行串味，也不让损坏行把版本号顶住', async () => {
    await initTemporaryDatabase()
    await saveRouteRuleSetVersion(ruleSetWithMarker('ok-'), '', '')

    const { createWorkflow } = await import('./workflow-store')
    // 手工塞一行损坏的规则表（历史数据或手改过的记录），版本号排在可解析那一行之上。
    await createWorkflow({ type: ROUTE_RULE_TYPE, version: 2, name: '', description: '', definition: { version: 1, rules: 'not-an-array' } })
    // 同一张表里的图版本行不该被规则表的读取看见。
    await createWorkflow({ type: 'router', version: 9, name: '这是图', description: '', definition: { version: 1, nodes: [], edges: [] } })

    // 最新那一行坏了也不能把整个读取拖下水：退回下一行可解析的规则表。
    expect((await readRouteRuleSnapshot())?.version).toBe(1)
    expect((await resolveRouteRuleSet()).version).toBe(1)
    expect((await listRouteRuleSetVersions()).map(summary => summary.version)).toEqual([1])

    // 但版本号仍然按真实最新行递增：损坏的那一版只是读不出来，不会把它占掉的位置再发一次。
    expect((await saveRouteRuleSetVersion(ruleSetWithMarker('next-'), '', ''))).toMatchObject({ version: 3, created: true })
  })

  it('超出上限时从最旧的开始丢，历史行还在但不再参与读取', async () => {
    await initTemporaryDatabase()

    for (let index = 1; index <= MAX_ROUTE_RULE_VERSIONS + 2; index += 1) {
      await saveRouteRuleSetVersion(ruleSetWithMarker(`v${index}-`), `第 ${index} 版`, '')
    }

    const versions = await listRouteRuleSetVersions()
    expect(versions).toHaveLength(MAX_ROUTE_RULE_VERSIONS)
    expect(versions[0].version).toBe(MAX_ROUTE_RULE_VERSIONS + 2)
    expect(versions[versions.length - 1].version).toBe(3)
    expect(await readRouteRuleSetVersion(2)).toBeNull()
    expect(await countRows()).toBe(MAX_ROUTE_RULE_VERSIONS)
  })
})
