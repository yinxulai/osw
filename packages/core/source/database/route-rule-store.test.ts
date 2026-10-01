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
  listRouteRuleSetVersions,
  readRouteRuleSetVersion,
  readRouteRuleSetVersionByNumber,
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
  const { getConfigDb } = await import('./index')
  const { routeRuleSets } = await import('./config-schema')
  return getConfigDb().select().from(routeRuleSets).all().length
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
    expect(first.id).not.toBe(second.id)

    // 版本列表新的在前，两个版本都在（保存不是原地改写）。
    const versions = await listRouteRuleSetVersions()
    expect(versions.map(summary => summary.version)).toEqual([2, 1])
    expect(versions.map(summary => summary.name)).toEqual(['第二版', '第一版'])
    expect(await countRows()).toBe(2)

    // 代理此刻执行的是第二版，旧版仍然可按记录 id 取回来。
    const resolved = await resolveRouteRuleSet()
    expect(resolved.version).toBe(2)
    expect(isSameRouteRuleSet(resolved.ruleSet, ruleSetWithMarker('v2-'))).toBe(true)

    const rolledBack = await readRouteRuleSetVersion(first.id)
    expect(rolledBack?.version).toBe(1)
    expect(isSameRouteRuleSet(rolledBack!.ruleSet, ruleSetWithMarker('v1-'))).toBe(true)
    expect(await readRouteRuleSetVersion('route_does_not_exist')).toBeNull()
    // 按展示用的版本号也能找到同一行（恢复入口走的就是它）。
    expect(await readRouteRuleSetVersionByNumber(1)).toMatchObject({ id: first.id, version: 1 })
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

  it('名字可以留空：一个人认这一版靠的是记录 id，不是名字', async () => {
    await initTemporaryDatabase()

    const saved = await saveRouteRuleSetVersion(ruleSetWithMarker('anon-'), undefined, undefined)

    expect(saved).toMatchObject({ version: 1, created: true, name: '', description: '' })
    // 名字空着也要能载回来：它是这一版的内容，不是它的身份。
    expect(isSameRouteRuleSet((await readRouteRuleSetVersion(saved.id))!.ruleSet, ruleSetWithMarker('anon-'))).toBe(true)
  })

  it('两种定义各住各的表：读规则表看不见图的版本行', async () => {
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

  it('跳过内容损坏的行，也不让损坏行把版本号顶住', async () => {
    await initTemporaryDatabase()
    await saveRouteRuleSetVersion(ruleSetWithMarker('ok-'), '', '')

    const { getConfigDb } = await import('./index')
    const { routeRuleSets } = await import('./config-schema')
    // 手工塞一行损坏的规则表（历史数据或手改过的记录），版本号排在可解析那一行之上。
    getConfigDb().insert(routeRuleSets).values({ id: 'route_corrupt', version: 2, name: '', description: '', definition: JSON.stringify({ version: 1, rules: 'not-an-array' }), createdTime: 0, updatedTime: 0 }).run()

    // 最新那一行坏了也不能把整个读取拖下水：退回下一行可解析的规则表。
    expect((await readRouteRuleSnapshot())?.version).toBe(1)
    expect((await resolveRouteRuleSet()).version).toBe(1)
    expect((await listRouteRuleSetVersions()).map(summary => summary.version)).toEqual([1])

    // 但版本号仍然按真实最新行递增：损坏的那一版只是读不出来，不会把它占掉的位置再发一次。
    expect((await saveRouteRuleSetVersion(ruleSetWithMarker('next-'), '', ''))).toMatchObject({ version: 3, created: true })
  })

  it('超出上限时列表只展示最近若干版，更旧的行还在库里', async () => {
    await initTemporaryDatabase()

    for (let index = 1; index <= MAX_ROUTE_RULE_VERSIONS + 2; index += 1) {
      await saveRouteRuleSetVersion(ruleSetWithMarker(`v${index}-`), `第 ${index} 版`, '')
    }

    const versions = await listRouteRuleSetVersions()
    expect(versions).toHaveLength(MAX_ROUTE_RULE_VERSIONS)
    expect(versions[0].version).toBe(MAX_ROUTE_RULE_VERSIONS + 2)
    expect(versions[versions.length - 1].version).toBe(3)
    // 列表截断不是删除：行都还在库里，只是不再列出来。
    expect(await countRows()).toBe(MAX_ROUTE_RULE_VERSIONS + 2)
  })
})
