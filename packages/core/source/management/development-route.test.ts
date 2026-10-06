import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, initDatabases } from '../database'
import { listProviders } from '../database/provider-store'
import { getRequestLog, getRequestUsage, listRequestLogs } from '../database/request-log-store'
import { configureSecretStore } from '../infrastructure/secrets/secret-store'
import { developmentRoutes } from './routes/operations/development'

/**
 * 开发环境种子接口。
 *
 * 这个端点的取值是「一条命令就能把界面喂成有数据的样子」，所以它跟别处有两个不同：
 *
 *   1. 它**允许已有配置**（`{ allowExisting: true }`）。`seedDevelopmentData` 的默认行为是
 *      「有配置就什么都不做」，那对启动时的自动填充是对的，对这个显式点击的接口就变成了
 *      「点了没反应」。
 *   2. 它被 `core/environment-guard.ts` 限制在 development 环境，所以路由里不重复判断环境。
 *
 * 路径访问权限（生产回 404）由 `environment-guard` 自己覆盖；这里验的是路由把「插了多少行」
 * 如实回报，以及它在有既有配置时仍然真的写入了。
 */

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-development-route-'))
  await initDatabases(temporaryDirectory)
  const secrets = new Map<string, string>()
  const secretStore: SecretStore = {
    set: async (reference, value) => { secrets.set(reference, value) },
    get: async reference => secrets.get(reference) ?? null,
    delete: async reference => { secrets.delete(reference) },
  }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('development seed route', () => {
  it('seeds an empty database and reports that rows were inserted', async () => {
    const response = await developmentRoutes.request('/api/development/seed', {})

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ success: true, data: { inserted: true } })
    expect((await listProviders()).length).toBeGreaterThan(0)
  })

  it('still seeds when configuration already exists, because this endpoint is an explicit click', async () => {
    const first = await developmentRoutes.request('/api/development/seed', {})
    expect(first.json()).toEqual({ success: true, data: { inserted: true } })

    // 第二次点击仍然写：`allowExisting: true` 的意义就在这里。
    // 种子内部有幂等保护（不会把同一批数据插两遍），所以断言的是「不报错且确实有数据」。
    const second = await developmentRoutes.request('/api/development/seed', {})
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual({ success: true, data: { inserted: true, } })
    expect((await listProviders()).length).toBeGreaterThan(0)
  })

  it('seeds request logs that the analytics and request log pages can read back', async () => {
    await developmentRoutes.request('/api/development/seed', {})

    const logs = await listRequestLogs(50, 0, {})
    expect(logs.length).toBeGreaterThan(0)

    // 种子要能撑起用量/指标那几屏，所以至少得有一条记录带着可读的用量与明细。
    const detail = await getRequestLog(logs[0].id)
    expect(detail).toMatchObject({ id: logs[0].id })
    const usage = await getRequestUsage(logs[0].id)
    expect(usage.inputTokens + usage.outputTokens).toBeGreaterThan(0)
  })
})
