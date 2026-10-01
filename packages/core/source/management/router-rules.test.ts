import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNSAVED_ROUTE_RULE_VERSION } from '@common/router/route-rules'
import type { RouteRuleSet } from '@common/router/route-rules'
import { readRouteRuleSnapshot } from '@server/database/route-rule-store'
import { closeDatabases, initDatabases } from '../database'
import { routerRuleRoutes } from './routes/router/rules'
import { mockResponse } from './test-support'

/**
 * 规则表那一组接口的契约。
 *
 * 与图那一组**形状一致**：`/rules` 读当前生效的，`/versions` 列版本，`/version` 读指定版本，
 * `/save` 保存为新版本。这组断言盯着四件容易在重构里丢掉的事：一版都没保存过时给的是
 * 内建默认表（不是空表）、每次保存真的生成一个新版本、内容没变时不新增、
 * 以及**冒出来的 `apply` 接口不再存在** —— 规则表已经不允许「改完直接覆盖」。
 */

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

function ruleSetWith(fallbackModelIds: string[]): RouteRuleSet {
  return {
    version: 1,
    rules: [
      {
        id: 'rule_requested_model',
        name: '按请求头指定模型',
        enabled: true,
        logicalOperator: 'and',
        conditions: [
          {
            fieldPath: 'request.headers.x-route-model',
            valueType: 'string',
            operator: 'equals',
            valueSource: 'literal',
            valueFieldPath: '',
            value: 'fast',
          },
        ],
        landing: { source: 'fixed', logicalModelIds: ['model-fast'], variablePath: 'request.body.model' },
      },
    ],
    fallbackModelIds,
  }
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-router-rules-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('router rule routes', () => {
  it('一版都没保存过时读到的就是内建默认表', async () => {
    const res = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules', res, {})
    expect(responseData(res)).toMatchObject({ success: true, data: { version: UNSAVED_ROUTE_RULE_VERSION } })
  })

  it('saves a new version on every save, and the proxy reads the latest one', async () => {
    const firstRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/save', firstRes, { ruleSet: ruleSetWith(['model-fallback']) })
    expect(responseData(firstRes)).toMatchObject({
      success: true,
      data: { version: 1, created: true, ruleCount: 1, name: '', description: '' },
    })

    // 内容一模一样时不再堆一个重复版本，把最新版本号原样回给调用方。
    const identicalRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/save', identicalRes, { ruleSet: ruleSetWith(['model-fallback']), name: '重复存一次' })
    expect(responseData(identicalRes)).toMatchObject({ success: true, data: { version: 1, created: false } })

    const editedRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/save', editedRes, { ruleSet: ruleSetWith(['model-edited']), name: ' 改落点 ', description: '第二版' })
    expect(responseData(editedRes)).toMatchObject({ success: true, data: { version: 2, created: true, name: '改落点', description: '第二版' } })

    const readRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules', readRes, {})
    expect(responseData(readRes)).toMatchObject({
      success: true,
      data: { version: 2, ruleSet: { fallbackModelIds: ['model-edited'] } },
    })

    // 两条改动都各自留下了一版：代理读的是最新的，上一版随时能取回来。
    const snapshot = await readRouteRuleSnapshot()
    expect(snapshot?.version).toBe(2)
    expect(snapshot?.ruleSet.fallbackModelIds).toEqual(['model-edited'])
  })

  it('lists versions and reads one by record id', async () => {
    const firstSaved = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/save', firstSaved, { ruleSet: ruleSetWith(['model-first']), name: '第一版' })
    await routerRuleRoutes.invoke('/api/router/rules/save', mockResponse(), { ruleSet: ruleSetWith(['model-second']), name: '第二版' })

    const firstId = (responseData(firstSaved) as { data: { id: string } }).data.id

    const listRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/versions', listRes, {})
    expect(responseData(listRes).data).toMatchObject([
      { version: 2, name: '第二版', ruleCount: 1 },
      { id: firstId, version: 1, name: '第一版', ruleCount: 1 },
    ])

    const versionRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/version', versionRes, { id: firstId })
    expect(responseData(versionRes)).toMatchObject({
      success: true,
      data: { version: 1, ruleSet: { fallbackModelIds: ['model-first'] } },
    })

    // 记录 id 不存在时给 `null` 而不是报错：界面得能区分「取不到了」与「请求失败了」。
    const missingRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/version', missingRes, { id: 'route_does_not_exist' })
    expect(responseData(missingRes)).toMatchObject({ success: true, data: null })
  })

  it('has no apply endpoint — every edit has to be saved', async () => {
    await expect(routerRuleRoutes.invoke('/api/router/rules/apply', mockResponse(), {})).rejects.toThrow('Test route not found')
  })

  it('runs the rule set with the same decision the proxy would take', async () => {
    const matchedRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/run', matchedRes, {
      ruleSet: ruleSetWith(['model-fallback']),
      inputPayload: { request: { method: 'POST', path: '/v1/chat/completions', headers: { 'x-route-model': 'fast' }, body: {} } },
    })
    expect(responseData(matchedRes)).toMatchObject({
      success: true,
      data: { matchedRuleId: 'rule_requested_model', logicalModelIds: ['model-fast'], fallback: false, stopReason: 'rule' },
    })

    const fallbackRes = mockResponse()
    await routerRuleRoutes.invoke('/api/router/rules/run', fallbackRes, {
      ruleSet: ruleSetWith(['model-fallback']),
      inputPayload: { request: { method: 'POST', path: '/v1/chat/completions', headers: { 'x-route-model': 'slow' }, body: {} } },
    })
    expect(responseData(fallbackRes)).toMatchObject({
      success: true,
      data: { matchedRuleId: null, logicalModelIds: ['model-fallback'], fallback: true, stopReason: 'fallback' },
    })
  })
})
