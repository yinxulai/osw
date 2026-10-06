/**
 * `stop`：请另一个进程优雅退出。
 *
 * 这条命令的所有分支都围绕一件事：**进程还在不在**。它不能靠信号（Windows 上 `SIGTERM`
 * 是硬杀，数据库与监听端口都来不及收尾），只能走 HTTP 握手，而且**不按响应判定成败**——
 * 服务端收尾时会关掉监听，客户端可能在读完响应前就被断开，于是「已经停了」会被误报成
 * 「没人应答」。统一等进程真的从系统里消失，对两种情况都成立。
 *
 * 四条退出路径各自对应一句用户会看到的话，且退出码不同：
 *   0 没在跑（含「文件是上次崩溃留下来的」）/ 已经退出；
 *   1 清文件失败 / 被管理服务拒绝 / 等超时。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliArguments } from '../options'
import type { RuntimeFileState } from '../runtime-state'
import { runStop } from './stop'

const mocks = vi.hoisted(() => ({
  state: null as RuntimeFileState | null,
  alive: true,
  aliveChecks: 0,
  /** 逐次给出 `isProcessAlive` 的答案；用完后一律返回 `alive`。 */
  aliveSequence: [] as boolean[],
  removed: 0,
  removeError: null as unknown,
  apiResult: { ok: true, data: {} } as unknown,
  apiCalls: [] as unknown[],
  logged: [] as string[],
  errors: [] as string[],
}))

vi.mock('../runtime-state', async importOriginal => {
  const actual = await importOriginal<typeof import('../runtime-state')>()
  return {
    ...actual,
    readRuntimeState: async () => mocks.state,
    removeRuntimeState: async () => {
      if (mocks.removeError !== null) throw mocks.removeError
      mocks.removed += 1
    },
    isProcessAlive: () => {
      mocks.aliveChecks += 1
      return mocks.aliveSequence.length > 0 ? mocks.aliveSequence.shift()! : mocks.alive
    },
  }
})

vi.mock('../management-client', () => ({
  callManagementApi: async (options: unknown) => {
    mocks.apiCalls.push(options)
    return mocks.apiResult
  },
}))

// 真实的 `waitFor` 按毫秒轮询，超时用例要真等 10 秒。这里把「等」这件事本身抽掉，
// 只保留它的语义：轮询谓词，到上限还没变就返回 false。被验证的判断逻辑不受影响。
vi.mock('../async', () => ({
  waitFor: async (predicate: () => boolean, _timeoutMilliseconds: number) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (predicate()) return true
    }
    return false
  },
}))

const values: CliArguments = {
  command: 'stop',
  help: false,
  version: false,
  dataDir: null,
  host: null,
  proxyPort: null,
  managementPort: null,
  serveWeb: true,
  json: false,
}

function stateOf(pid: number): RuntimeFileState {
  return {
    pid,
    appVersion: '1.0.0',
    environment: 'development',
    managementHost: '127.0.0.1',
    managementPort: 9330,
    proxyHost: '127.0.0.1',
    proxyPort: 9300,
    webUrl: null,
    startedAt: new Date(0).toISOString(),
  }
}

beforeEach(() => {
  mocks.state = null
  mocks.alive = true
  mocks.aliveChecks = 0
  mocks.aliveSequence = []
  mocks.removed = 0
  mocks.removeError = null
  mocks.apiResult = { ok: true, data: {} }
  mocks.apiCalls = []
  mocks.logged = []
  mocks.errors = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { mocks.logged.push(args.join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { mocks.errors.push(args.join(' ')) })
})

describe('stop when there is no instance', () => {
  it('reports "not running" and exits cleanly when there is no runtime file', async () => {
    expect(await runStop(values)).toBe(0)
    expect(mocks.logged.join('\n')).toContain('is not running')
    expect(mocks.apiCalls).toHaveLength(0)
    expect(mocks.removed).toBe(0)
  })

  it('cleans up a runtime file left behind by a crashed process, then reports it as stale', async () => {
    mocks.state = stateOf(999_999)
    mocks.alive = false

    expect(await runStop(values)).toBe(0)
    expect(mocks.removed).toBe(1)
    // 报告里的路径要是那份**真被删掉**的文件，否则用户会去错地方找。
    expect(mocks.logged.join('\n')).toContain('stale runtime file')
    expect(mocks.logged.join('\n')).toContain('runtime.json')
    // 进程早就没了，没有理由去敲它的管理端口。
    expect(mocks.apiCalls).toHaveLength(0)
  })

  it('fails with exit code 1 when the stale file cannot be removed', async () => {
    mocks.state = stateOf(999_999)
    mocks.alive = false
    mocks.removeError = new Error('EPERM: operation not permitted')

    expect(await runStop(values)).toBe(1)
    expect(mocks.errors.join('\n')).toContain('Failed to stop OSW')
    expect(mocks.errors.join('\n')).toContain('EPERM: operation not permitted')
  })
})

describe('stop when an instance is running', () => {
  it('asks the management API to shut down and reports success once the process is gone', async () => {
    mocks.state = stateOf(4242)
    // 第一次探测（判断进程在不在）为真，之后为假（已经退出）。
    mocks.aliveSequence = [true, true, false]

    expect(await runStop(values)).toBe(0)
    expect(mocks.apiCalls).toEqual([{ host: '127.0.0.1', port: 9330, path: '/api/runtime/shutdown' }])
    expect(mocks.logged.join('\n')).toContain('OSW stopped.')
  })

  it('trusts the process disappearing over the HTTP response, so a rejected response is not fatal on its own', async () => {
    mocks.state = stateOf(4242)
    // 服务端收尾时把监听关了，客户端读到的是「连接被拒」——但进程确实退了。
    mocks.apiResult = { ok: false, reason: 'rejected', status: 502 }
    mocks.aliveSequence = [true, true, false]

    expect(await runStop(values)).toBe(0)
  })

  it('reports "rejected" and keeps the runtime file when the process stays alive', async () => {
    mocks.state = stateOf(4242)
    mocks.apiResult = { ok: false, reason: 'rejected', status: 502 }
    mocks.alive = true

    const exitCode = await runStop(values)

    expect(exitCode).toBe(1)
    expect(mocks.errors.join('\n')).toContain('rejected the shutdown request')
    // 进程还活着，那份快照还是它的，不能清。
    expect(mocks.removed).toBe(0)
  })

  it('reports a timeout when the process never goes away', async () => {
    mocks.state = stateOf(4242)
    mocks.apiResult = { ok: false, reason: 'unreachable' }
    mocks.alive = true

    const exitCode = await runStop(values)

    expect(exitCode).toBe(1)
    expect(mocks.errors.join('\n')).toContain('is still alive after 10s')
    expect(mocks.removed).toBe(0)
  })
})
