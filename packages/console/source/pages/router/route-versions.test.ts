import { describe, expect, it } from 'vitest'

import { UNSAVED_ROUTE_RULE_VERSION } from '@common/router/route-rules'
import { UNSAVED_ROUTER_GRAPH_VERSION } from '@common/router/types'
import { formatVersionTime, hasSavedVersion, toRouterGraphVersion, toRouterGraphVersions } from './route-versions'

describe('路由版本展示模型', () => {
  it('把服务端摘要翻成列表要用的形状', () => {
    const version = toRouterGraphVersion({ id: 'workflow_abc', version: 7, name: '命中分流', description: '按 UA 分流', savedAt: Date.parse('2026-09-11T14:41:05.000Z'), nodeCount: 4 })

    // 记录 id 是这一版的身份，恢复时要传的就是它；版本号只是给人看的序号。
    expect(version.id).toBe('workflow_abc')
    expect(version.sequence).toBe(7)
    expect(version.name).toBe('命中分流')
    expect(version.description).toBe('按 UA 分流')
    expect(version.savedAt).toBe('2026-09-11T14:41:05.000Z')
    expect(version.itemCount).toBe(4)
  })

  it('没起名就是空串，版本号不塞进名字里', () => {
    const version = toRouterGraphVersion({ id: 'workflow_anon', version: 3, name: '', description: '', savedAt: 0, nodeCount: 2 })

    // 版本号有自己的字段（`sequence`），名字不该被它占位。
    expect(version.name).toBe('')
    expect(version.sequence).toBe(3)
  })

  it('摘要列表按服务端给的顺序逐一转换', () => {
    const versions = toRouterGraphVersions([
      { id: 'workflow_c', version: 3, name: 'c', description: '', savedAt: 1_700_000_000_000, nodeCount: 5 },
      { id: 'workflow_b', version: 2, name: 'b', description: '', savedAt: 1_600_000_000_000, nodeCount: 4 },
    ])

    expect(versions.map(version => version.id)).toEqual(['workflow_c', 'workflow_b'])
    expect(versions.map(version => version.sequence)).toEqual([3, 2])
  })

  it('时间格式化按分钟精度输出，非法输入原样返回', () => {
    expect(formatVersionTime('2026-09-11T14:41:05.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatVersionTime('not-a-date')).toBe('not-a-date')
  })

  it('内建默认定义（版本号 0）不算已保存版本', () => {
    // 一版都没存过时服务端给的就是内建默认那一份：它算「当前生效」，但不算「用户存下来的」——
    // 否则保存按钮一打开就是灰的，用户没法把这份默认内容存成 v1。
    expect(UNSAVED_ROUTER_GRAPH_VERSION).toBe(UNSAVED_ROUTE_RULE_VERSION)
    expect(hasSavedVersion(UNSAVED_ROUTER_GRAPH_VERSION)).toBe(false)
    expect(hasSavedVersion(1)).toBe(true)
  })
})
