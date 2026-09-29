import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ServiceHost, type ServiceHostOptions, type ServiceHostState, type ServiceProcess } from './service-host'
import type { ServiceEvents } from './protocol'
import type { SecretStore } from '@common/secret-store'
import { createRuntimeConfig, type RuntimeConfig } from '@common/runtime-config'

// 这里用一个**真的** `worker_threads` 替身来测宿主，而不是塞一个假端口：
// 这次改动最容易出错的地方恰好是进程本身的行为——`exit` 之后还剩几条消息、
// `kill()` 会不会再触发一次 `exit`、重启的空窗里调用怎么答。假端口把这些全部抹平。
//
// 替身只讲线协议（`kind`/`id`/`method`），不 import 任何东西：它就是「对面是个黑盒」
// 这件事的具体化。协议本身的一致性归 `rpc.test.ts` 管。
//
// 为什么替身是线程而不是进程：测试跑在 `ELECTRON_RUN_AS_NODE=1` 的 Electron 里
// （为了和打包产物用同一个 `node:sqlite` ABI），那里没有 `utilityProcess`。
// 于是 `spawn` 这个注入口一方面是 core 不依赖 Electron 的边界，另一方面正好让这里
// 能用最轻的替身把生命周期逻辑跑完；真实进程的行为由打包后的冒烟验证覆盖。

const FIXTURE_SOURCE = `
const { parentPort } = require('node:worker_threads')
const settings = { listenHost: '127.0.0.1', listenPort: 9300, language: 'system' }
let pendingSecretReply = null
let runtimeConfig = null

const send = message => parentPort.postMessage(message)

parentPort.on('message', message => {
  if (message.kind === 'result' && message.id === 4000) {
    // 启动配置拿到了才开始干活——真实的服务进程也是这样（见 service-runtime.ts），
    // 所以宿主少注册一个 runtime.config 处理器，这条路会直接塌掉而不是静默跑偏。
    runtimeConfig = message.value
    send({
      kind: 'event',
      name: 'service.ready',
      payload: {
        endpoints: { managementHost: '127.0.0.1', managementPort: 1, proxyHost: '127.0.0.1', proxyPort: 9300, webRoot: null },
        settings,
        requestedRuntimeConfig: runtimeConfig,
      },
    })
    send({ kind: 'event', name: 'settings.changed', payload: { ...settings, language: 'zh-CN' } })
    return
  }
  if (message.kind === 'error' && message.id === 4000) {
    send({ kind: 'event', name: 'service.failed', payload: message.error })
    return
  }
  if (message.kind === 'result' && message.id === 5000) {
    send({ kind: 'result', id: pendingSecretReply, value: null })
    pendingSecretReply = null
    return
  }
  if (message.kind !== 'request') return
  const reply = value => send({ kind: 'result', id: message.id, value })
  switch (message.method) {
    case 'proxy.status':
      return reply({ running: true, host: '127.0.0.1', port: 9300 })
    case 'proxy.start': {
      // 反向依赖走一遍：服务要宿主替它写密钥（Electron 的 safeStorage 只有宿主有）。
      pendingSecretReply = message.id
      send({ kind: 'request', id: 5000, method: 'secrets.set', params: { reference: 'fixture-key', value: 'secret-value' } })
      return
    }
    case 'proxy.stop':
      // 自杀，模拟运行期崩溃。替身是线程，process.exit 在这里只结束这个线程
      // ——正因为如此它才适合当替身：宿主看到的 exit 与真实进程崩溃同形。
      return process.exit(9)
    case 'settings.get':
      return reply(settings)
    case 'runtime.stop':
      return reply(null)
    default:
      return send({ kind: 'error', id: message.id, error: { name: 'Error', message: 'unknown method' } })
  }
})

send({ kind: 'request', id: 4000, method: 'runtime.config', params: undefined })
`

/** 替身把拿到的 `runtime.config` 顺带捎了回来；这一项不属于正式载荷，只为断言用。 */
type ReadyWithRuntimeConfig = ServiceEvents['service.ready'] & { requestedRuntimeConfig: RuntimeConfig }

let temporaryDirectory: string
const running = new Set<ServiceHost>()

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-service-host-'))
})

afterEach(async () => {
  for (const host of running) await host.stop()
  running.clear()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

interface Harness {
  host: ServiceHost
  secrets: Map<string, string>
  /** 每次「起一个进程」时拿到的入口路径。 */
  spawned: string[]
  /** 进程推给宿主的设置变更，按到达顺序记着。 */
  pushed: string[]
  states: ServiceHostState[]
}

/** 把替身线程包成宿主认识的 `ServiceProcess`（桌面端那份用 `utilityProcess`）。 */
function spawnFixtureThread(): ServiceProcess {
  const worker = new Worker(FIXTURE_SOURCE, { eval: true })
  return {
    postMessage: message => {
      worker.postMessage(message)
    },
    onMessage: listener => {
      worker.on('message', listener)
    },
    onExit: listener => {
      worker.on('exit', listener)
    },
    kill: () => {
      void worker.terminate()
    },
  }
}

function createHost(overrides: Partial<ServiceHostOptions> = {}): Harness {
  const secrets = new Map<string, string>()
  const secretStore: SecretStore = {
    set: async (reference, value) => {
      secrets.set(reference, value)
    },
    get: async reference => secrets.get(reference) ?? null,
    delete: async reference => {
      secrets.delete(reference)
    },
  }
  const spawned: string[] = []
  const pushed: string[] = []
  const states: ServiceHostState[] = []

  const host = new ServiceHost({
    runtimeConfig: createRuntimeConfig({ environment: 'development', appVersion: '0.0.0-test', runtime: 'desktop', dataDir: temporaryDirectory }),
    secretStore,
    systemProxyResolver: async () => 'DIRECT',
    serviceEntry: 'fixture',
    // 默认不重启：绝大多数用例只关心「一条命」里的行为，重启单独测。
    restart: null,
    spawn: entry => {
      spawned.push(entry)
      return spawnFixtureThread()
    },
    ...overrides,
  })
  host.onSettingsChanged(settings => pushed.push(settings.language))
  host.onStateChanged(state => states.push(state))
  running.add(host)
  return { host, secrets, spawned, pushed, states }
}

describe('service host startup', () => {
  it('resolves with the endpoints and settings the service announced', async () => {
    const harness = createHost()
    const result = await harness.host.start()

    expect(result.endpoints.proxyPort).toBe(9300)
    expect(result.settings).toMatchObject({ language: 'system' })
    expect(harness.host.getState().kind).toBe('running')
  })

  it('answers the runtime config the service asks for', async () => {
    const harness = createHost()
    const result = await harness.host.start() as ReadyWithRuntimeConfig

    expect(harness.spawned).toEqual(['fixture'])
    // 服务拿到的是宿主那份配置的**原值**，不是被谁重算过一遍的东西。
    expect(result.requestedRuntimeConfig.dataDir).toBe(temporaryDirectory)
  })

  it('refuses to start twice', async () => {
    const harness = createHost()
    await harness.host.start()

    await expect(harness.host.start()).rejects.toThrow('already running')
  })

  it('settles an in-flight start when the host is stopped', async () => {
    const harness = createHost()

    // 启动是异步的（服务起来要一百多毫秒），这中间随时可能收到退出请求。
    // 断言先挂上，别让这次拒绝在 `stop()` 返回前变成一条无人认领的 unhandled rejection。
    const starting = harness.host.start()
    const rejected = expect(starting).rejects.toThrow('Service host stopped')
    await harness.host.stop()

    // 被叫停的那次启动必须**有结论**：既不留在那里等一个永不到来的 `service.ready`，
    // 也不能把状态翻回 `running`。
    await rejected
    expect(harness.host.getState().kind).toBe('stopped')
  })

  it('rejects instead of hanging when no service process is attached', async () => {
    const harness = createHost()
    await expect(harness.host.getProxyStatus()).rejects.toThrow('not running')
  })
})

describe('service host calls', () => {
  it('forwards proxy calls over the port', async () => {
    const harness = createHost()
    await harness.host.start()

    expect(await harness.host.getProxyStatus()).toMatchObject({ running: true, port: 9300 })
  })

  it('serves secrets for the service through the injected store', async () => {
    const harness = createHost()
    await harness.host.start()

    await harness.host.startProxy()

    expect(harness.secrets.get('fixture-key')).toBe('secret-value')
  })
})

describe('service host settings cache', () => {
  it('caches the settings the service pushed', async () => {
    const harness = createHost()
    await harness.host.start()

    await waitFor(() => harness.pushed.at(-1) === 'zh-CN')
    expect(await harness.host.getSettings()).toMatchObject({ language: 'zh-CN' })
  })

  it('drops the cache when the host stops', async () => {
    const harness = createHost()
    await harness.host.start()
    await waitFor(() => harness.pushed.at(-1) === 'zh-CN')

    await harness.host.stop()

    await expect(harness.host.getSettings()).rejects.toThrow('not running')
    expect(harness.host.getState().kind).toBe('stopped')
  })

  it('is idempotent when stopped twice', async () => {
    const harness = createHost()
    await harness.host.start()

    await harness.host.stop()
    await harness.host.stop()

    expect(harness.host.getState().kind).toBe('stopped')
  })
})

describe('service host crash handling', () => {
  it('restarts the service and re-announces running', async () => {
    const harness = createHost({
      restart: { maxAttempts: 3, delayMilliseconds: 5, stableUptimeMilliseconds: 60_000 },
    })
    await harness.host.start()

    // `proxy.stop` 会把替身打死，挂起的这个调用必须被拒掉而不是永远等。
    await expect(harness.host.stopProxy()).rejects.toThrow()

    await waitFor(() => harness.host.getState().kind === 'running')
    expect(harness.spawned).toHaveLength(2)
    expect(harness.states.some(state => state.kind === 'restarting')).toBe(true)
    // 新进程是活的：同一个调用又能答了。
    expect(await harness.host.getProxyStatus()).toMatchObject({ running: true })
  })

  it('gives up once the restart budget is spent', async () => {
    const harness = createHost({
      restart: { maxAttempts: 1, delayMilliseconds: 5, stableUptimeMilliseconds: 60_000 },
    })
    await harness.host.start()

    await expect(harness.host.stopProxy()).rejects.toThrow()
    await waitFor(() => harness.host.getState().kind === 'running')
    expect(harness.spawned).toHaveLength(2)

    // 第二次崩溃就没有预算了：宿主应该停下来把错误交出去，而不是无限重起。
    await expect(harness.host.stopProxy()).rejects.toThrow()
    await waitFor(() => harness.host.getState().kind === 'failed')

    expect(harness.spawned).toHaveLength(2)
  })

  it('stays failed when there is no restart policy', async () => {
    const harness = createHost()
    await harness.host.start()

    await expect(harness.host.stopProxy()).rejects.toThrow()

    await waitFor(() => harness.host.getState().kind === 'failed')
    expect(harness.spawned).toHaveLength(1)
  })
})

async function waitFor(predicate: () => boolean, timeoutMilliseconds = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected state')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
