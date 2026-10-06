import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { cloudSyncRoutes } from './routes/operations/cloud-sync'

/**
 * 云同步路由。
 *
 * 路由自己不含业务：五个动作各自把请求交给 `cloud-sync/service` 并把结果原样写出。
 * 这里要钉住的是**这层转发没有走样**——尤其是「未配置」这条最常走到的分支：
 * 用户还没绑远端时，状态接口要回一份能用的状态，而不是抛错。
 *
 * 真的联网请求由 `cloud-sync.test.ts` 覆盖（那边替换掉了 HTTP 出口），这里全部打桩，
 * 只验「路由调了这个函数、把它的返回值给了调用方」。
 */

const { service } = vi.hoisted(() => ({
  service: {
    getCloudSyncStatus: vi.fn(),
    configureCloudSync: vi.fn(),
    testCloudSync: vi.fn(),
    pushConfigSnapshot: vi.fn(),
    pullConfigSnapshot: vi.fn(),
  },
}))

vi.mock('./cloud-sync/service', () => service)

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-cloud-sync-route-'))
  await initDatabases(temporaryDirectory)
  for (const fn of Object.values(service)) fn.mockReset()
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('cloud sync routes', () => {
  it('exposes every action as an explicit POST', async () => {
    // 动作里有联网操作，用 GET 会被代理与日志记成「读」——这条约定值得钉住。
    for (const action of ['status', 'configure', 'test', 'push', 'pull']) {
      expect(cloudSyncRoutes.match('POST', `/api/cloud-sync/${action}`)).toBeDefined()
      expect(cloudSyncRoutes.match('GET', `/api/cloud-sync/${action}`)).toBeUndefined()
    }
  })

  it('returns the status as-is', async () => {
    service.getCloudSyncStatus.mockResolvedValue({ provider: 'github-gist', credentialConfigured: false })

    const response = await cloudSyncRoutes.request('/api/cloud-sync/status', {})

    expect(response.json()).toEqual({ success: true, data: { provider: 'github-gist', credentialConfigured: false } })
  })

  it('passes the configure body through untouched', async () => {
    service.configureCloudSync.mockResolvedValue({ provider: 'github-gist' })

    const body = { provider: 'github-gist', credential: 'ghp_x', target: 'a'.repeat(32) }
    await cloudSyncRoutes.request('/api/cloud-sync/configure', body)

    // 校验是 service 里那一份（引用了 `@common/cloud-sync` 的 zod schema），路由不重复做一遍。
    expect(service.configureCloudSync).toHaveBeenCalledWith(body)
  })

  it('surfaces a rejected credential as an HTTP error instead of a fake success', async () => {
    service.testCloudSync.mockRejectedValue(new Error('Credential rejected by GitHub'))

    await expect(cloudSyncRoutes.request('/api/cloud-sync/test', {})).rejects.toThrow('Credential rejected by GitHub')
  })

  it('writes and reads through the service', async () => {
    service.pushConfigSnapshot.mockResolvedValue({ target: 'gist-1', pushedTime: 1 })
    service.pullConfigSnapshot.mockResolvedValue({ target: 'gist-1', imported: true })

    const pushed = await cloudSyncRoutes.request('/api/cloud-sync/push', {})
    const pulled = await cloudSyncRoutes.request('/api/cloud-sync/pull', {})

    expect(pushed.json()).toEqual({ success: true, data: { target: 'gist-1', pushedTime: 1 } })
    expect(pulled.json()).toEqual({ success: true, data: { target: 'gist-1', imported: true } })
  })
})
