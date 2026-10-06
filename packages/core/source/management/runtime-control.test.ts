import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { updateSettings } from '../database/settings-store'
import { getManualModel, setManualModel } from '../proxy/routing/manual-routing'
import { configureShutdownHandshake } from './core/shutdown-handshake'
import { runtimeControlRoutes } from './routes/operations/runtime-control'

/**
 * 代理进程本身有 `server-lifecycle.test.ts` 直接用真端口验过；这里只验接口层——
 * 它是不是照「启动 → 重新读状态」的顺序回答、restart 用的是**设置里存的**地址。
 */
interface RestartOptions { host?: string; port?: number }

const mocks = vi.hoisted(() => ({
  status: { running: false, host: '127.0.0.1', port: 9300 },
  starts: 0,
  stops: 0,
  restarts: 0,
  statusReads: 0,
  restartOptions: null as RestartOptions | null,
}))

vi.mock('../proxy/runtime/server', () => ({
  getProxyServerStatus: async () => {
    mocks.statusReads += 1
    return mocks.status
  },
  startProxyServer: async () => {
    mocks.starts += 1
  },
  stopProxyServer: async () => {
    mocks.stops += 1
  },
  restartProxyServer: async (options: RestartOptions) => {
    mocks.restarts += 1
    mocks.restartOptions = options
  },
}))

/**
 * 运行时控制路由。
 *
 * 这组接口是界面上「服务开着没有」「这一条逻辑模型现在锁在哪」的唯一读法，也是 CLI `stop`
 * 能优雅收尾的唯一入口（`POST /api/runtime/shutdown`）。三条要点：
 *
 *   1. `/api/runtime/shutdown` **只在宿主显式装了握手的形态下存在**（CLI 装了、桌面没装），
 *      没装时必须回 404 而不是 200——回 200 等于骗调用方「已经在停了」。
 *   2. 装了握手时，回调挂在响应的 `finish` 上而不是当场触发：宿主一收尾就关监听，
 *      当场触发会把这次响应自己掐掉。
 *   3. 手动锁定读写的键要与代理侧一致（模型名），这里只验路由把值透传得对。
 */

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-runtime-control-'))
  await initDatabases(temporaryDirectory)
  configureShutdownHandshake(null)
  // 模块级的手动锁定表跟着进程活，用例之间必须自己清干净。
  setManualModel('default', null)
  mocks.status = { running: false, host: '127.0.0.1', port: 9300 }
  mocks.starts = 0
  mocks.stops = 0
  mocks.restarts = 0
  mocks.statusReads = 0
  mocks.restartOptions = null
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  configureShutdownHandshake(null)
})

/** 一个记得住 `finish` 监听器的响应替身：退出握手就挂在这个事件上。 */
function finishableResponse(): { response: ServerResponse; finish: () => void } {
  let finishListener: (() => void) | undefined
  const response = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    destroy: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
    once: (event: string, listener: () => void) => {
      if (event === 'finish') finishListener = listener
      return response
    },
  } as unknown as ServerResponse
  return {
    response,
    finish: () => {
      if (!finishListener) throw new Error('nothing was registered for the finish event')
      finishListener()
    },
  }
}

describe('logical model manual routing', () => {
  it('reports no manual override when this model is on automatic', async () => {
    const response = await runtimeControlRoutes.request('/api/logical-model/status', { logicalModelId: 'default' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ success: true, data: { logicalModelId: 'default', manualModelId: null } })
  })

  it('locks a model onto a provider model and reports it back', async () => {
    const switched = await runtimeControlRoutes.request('/api/logical-model/switch', { logicalModelId: 'default', modelId: 'model_abc' })

    expect(switched.statusCode).toBe(200)
    expect(switched.json()).toEqual({ success: true, data: { logicalModelId: 'default', modelId: 'model_abc' } })
    // 写进去的值必须能被代理侧那套读法读到：两边共用一个键（模型名）。
    expect(getManualModel('default')).toBe('model_abc')
  })

  it('releases the lock when switching back to automatic', async () => {
    setManualModel('default', 'model_abc')

    const switched = await runtimeControlRoutes.request('/api/logical-model/switch', { logicalModelId: 'default', modelId: null })

    expect(switched.json()).toEqual({ success: true, data: { logicalModelId: 'default', modelId: null } })
    expect(getManualModel('default')).toBeNull()
  })

  it('rejects a switch request that carries no logical model', async () => {
    await expect(runtimeControlRoutes.request('/api/logical-model/switch', { logicalModelId: '', modelId: null })).rejects.toThrow()
  })
})

describe('health list route', () => {
  it('answers with both health lists, even when nothing has failed yet', async () => {
    const response = await runtimeControlRoutes.request('/api/health/list', {})

    // 形状是**数组**（每条都是一行健康记录），不是按 id 索引的对象——
    // 「还没失败过」就是空数组，界面靠它判断「没有任何一个在冷却」。
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ success: true, data: { providers: [], providerModels: [] } })
  })
})

describe('proxy control routes', () => {
  it('reports the current status without touching the proxy', async () => {
    mocks.status = { running: true, host: '0.0.0.0', port: 9300 }

    const response = await runtimeControlRoutes.request('/api/proxy/status', {})

    expect(response.json()).toEqual({ success: true, data: { running: true, host: '0.0.0.0', port: 9300 } })
    expect(mocks.starts + mocks.stops + mocks.restarts).toBe(0)
  })

  it('starts the proxy and answers with the status read after starting, not before', async () => {
    // 调用前是停的，调用后是开的：接口回答的必须是**之后**那个值，否则界面会把刚点开的开关又画回去。
    mocks.status = { running: true, host: '127.0.0.1', port: 9300 }

    const response = await runtimeControlRoutes.request('/api/proxy/start', {})

    expect(mocks.starts).toBe(1)
    expect(mocks.statusReads).toBe(1)
    expect(response.json()).toEqual({ success: true, data: { running: true, host: '127.0.0.1', port: 9300 } })
  })

  it('stops the proxy and answers with the status read after stopping', async () => {
    mocks.status = { running: false, host: '127.0.0.1', port: 9300 }

    const response = await runtimeControlRoutes.request('/api/proxy/stop', {})

    expect(mocks.stops).toBe(1)
    expect(mocks.statusReads).toBe(1)
    expect(response.json()).toEqual({ success: true, data: { running: false, host: '127.0.0.1', port: 9300 } })
  })

  it('restarts on the address saved in settings, so a listen-address change takes effect immediately', async () => {
    await updateSettings({ listenHost: '127.0.0.1', listenPort: 9411 })
    mocks.status = { running: true, host: '127.0.0.1', port: 9411 }

    const response = await runtimeControlRoutes.request('/api/proxy/restart', {})

    expect(mocks.restarts).toBe(1)
    // 不能回落到默认端口：用户在设置里改了地址再点重启，改的就得是新地址。
    expect(mocks.restartOptions).toEqual({ host: '127.0.0.1', port: 9411 })
    expect(response.json()).toEqual({ success: true, data: { running: true, host: '127.0.0.1', port: 9411 } })
  })
})

describe('runtime shutdown route', () => {
  it('answers 404 when the host never installed the handshake', async () => {
    const response = await runtimeControlRoutes.request('/api/runtime/shutdown', {})

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ success: false, errorCode: 'RESOURCE_NOT_FOUND' })
  })

  it('accepts the request and only then lets the host start stopping', async () => {
    const onRequest = vi.fn()
    configureShutdownHandshake({ onRequest })

    const { response, finish } = finishableResponse()
    await runtimeControlRoutes.invoke('/api/runtime/shutdown', response, {})

    // 响应先写出去，宿主还没有开始收尾——否则这次响应会被连同监听一起掐掉。
    expect(response.statusCode).toBe(200)
    expect(onRequest).not.toHaveBeenCalled()

    finish()
    expect(onRequest).toHaveBeenCalledTimes(1)
  })
})
