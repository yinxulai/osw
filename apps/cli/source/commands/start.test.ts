/**
 * `start`：把服务在前台拉起来。
 *
 * 这是整个 CLI 里分支最多的一段（能力探测、产物校验、实例锁、端口占用、运行时文件、
 * 语言同步、信号收尾、崩溃兜底），而且每一条分支都对应一句用户会看到的输出。用例按
 * 「启动前的拒绝」→「成功启动」→「启动失败」→「收尾」四段走，重点是：
 *   - 拒绝启动时**不能**留下运行时文件（否则 `status` 会报一个不存在实例）；
 *   - 失败路径的错误要能被用户区分（实例锁 / 端口占用 / 其它），因为它们下一步的动作不同；
 *   - 收尾只做一次（信号与退出握手可能撞在一起），且收尾失败不改变退出码。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstanceLockError } from '@server/runtime/instance-lock'
import type { ServerEndpoints, StartServerOptions } from '@server/index'
import type { CliArguments } from '../options'
import { applySystemLocale } from '../native-i18n'
import type { RuntimeFileState } from '../runtime-state'
import { runStart } from './start'

const mocks = vi.hoisted(() => ({
  webRoot: '',
  proxyHost: '127.0.0.1',
  proxyPort: 9300,
  startOptions: null as StartServerOptions | null,
  startError: null as unknown,
  stopError: null as unknown,
  /** 上一次 `startServer` 的调用次数与 `stopServer` 的调用次数。 */
  startCount: 0,
  stopCount: 0,
  /** 运行时文件被清理的次数。 */
  removed: 0,
  written: [] as RuntimeFileState[],
  previous: null as RuntimeFileState | null,
  alive: false,
  writeError: null as unknown,
  syncError: null as unknown,
  syncStops: 0,
}))

vi.mock('@server/index', () => ({
  startServer: async (options: StartServerOptions): Promise<ServerEndpoints> => {
    mocks.startCount += 1
    mocks.startOptions = options
    if (mocks.startError !== null) throw mocks.startError
    const config = options.runtimeConfig
    const endpoints: ServerEndpoints = {
      managementHost: config.managementHost,
      managementPort: config.managementPort,
      // 代理的实际监听地址来自设置，未必等于本次启动传的值——这里刻意与配置分开，
      // 好让「以 endpoints 为准」这件事被真的验证到。
      proxyHost: mocks.proxyHost,
      proxyPort: mocks.proxyPort,
      webRoot: config.serveWeb ? config.webRoot : null,
    }
    return endpoints
  },
  stopServer: async (): Promise<void> => {
    mocks.stopCount += 1
    if (mocks.stopError !== null) throw mocks.stopError
  },
}))

vi.mock('../runtime-state', () => ({
  runtimeFilePath: (dataDirectory: string) => `${dataDirectory}/runtime.json`,
  readRuntimeState: async () => mocks.previous,
  writeRuntimeState: async (_dataDirectory: string, state: RuntimeFileState) => {
    if (mocks.writeError !== null) throw mocks.writeError
    mocks.written.push(state)
  },
  removeRuntimeState: async () => {
    mocks.removed += 1
  },
  isProcessAlive: () => mocks.alive,
}))

vi.mock('../host', async importOriginal => {
  const actual = await importOriginal<typeof import('../host')>()
  return { ...actual, consoleWebRoot: () => mocks.webRoot }
})

vi.mock('../native-i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('../native-i18n')>()
  return {
    ...actual,
    startCliLanguageSync: async () => {
      if (mocks.syncError !== null) throw mocks.syncError
      return () => {
        mocks.syncStops += 1
      }
    },
  }
})

// 收尾路径用 `delay(SHUTDOWN_TIMEOUT)` 给 `stopServer()` 兜底。真等 5 秒会让这个文件
// 白慢一大截，而且「谁先 settle」在两边都立刻有结果时本来就有确定答案：`stopServer()`
// 先被创建、先挂上 race，所以它总是赢。
vi.mock('../async', () => ({ delay: async () => undefined }))

const DATA_DIRECTORY = path.join(os.tmpdir(), 'osw-cli-start')

let stdout: string[]
let stderr: string[]
let baseline: Record<string, unknown[]>

const TRACKED = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const

/**
 * `start` 会往进程级注册信号与崩溃钩子。用例之间必须清干净：不然后一个用例触发的
 * 信号会把前一个用例已经「结束」的实例再收尾一次，而且监听器累积到 10 个之后
 * Node 会打警告，把真正的问题淹掉。
 */
function trackListeners(): Record<string, unknown[]> {
  return Object.fromEntries(TRACKED.map(name => [name, process.listeners(name)]))
}

function restoreListeners(snapshot: Record<string, unknown[]>): void {
  for (const name of TRACKED) {
    const before = snapshot[name] ?? []
    for (const listener of process.listeners(name)) {
      if (!before.includes(listener)) process.off(name, listener)
    }
  }
}

function addedListeners(name: string): ((argument: unknown) => void)[] {
  const before = baseline[name] ?? []
  return process.listeners(name).filter(listener => !before.includes(listener)) as never
}

function cliArguments(overrides: Partial<CliArguments> = {}): CliArguments {
  return {
    command: 'start',
    help: false,
    version: false,
    dataDir: DATA_DIRECTORY,
    host: null,
    proxyPort: null,
    managementPort: null,
    serveWeb: true,
    json: false,
    ...overrides,
  }
}

/**
 * 等到条件成立。
 *
 * 刻意不用 `vi.waitFor`：`start` 往进程上挂信号与崩溃钩子，这些用例里同时有真实定时器和
 * 假定时器，一个十行的轮询比「等待助手内部怎么安排定时器」更好推断，卡住时也能直接看出
 * 等的是哪一步。
 */
async function waitUntil(predicate: () => boolean, description: string, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/**
 * 一次「已经起来、还没收尾」的运行。
 *
 * 刻意用对象包住那个退出码 promise：直接把 promise 从 `async` 函数里返回，它会被自动
 * 吸收，`await launch()` 就变成等待服务退出——而服务正是要等到用例主动收尾才退出。
 */
interface RunningInstance {
  finished: Promise<number>
}

/** 拉到「服务已经起来」这一步。 */
async function launch(overrides: Partial<CliArguments> = {}): Promise<RunningInstance> {
  const finished = runStart(cliArguments(overrides))
  await waitUntil(() => mocks.startCount === 1, 'the server is started')
  return { finished }
}

/**
 * 请求退出，并等到退出码落地。
 *
 * 除了退出码，这里还校验运行时文件被清掉了：少了这一件事，下一次 `status` 或 `stop`
 * 就会对着一个不存在的实例说话。
 */
async function stopAndWait(run: Promise<RunningInstance> | RunningInstance, alreadyRequested = false): Promise<number> {
  const instance = await run
  const removalsBefore = mocks.removed
  if (!alreadyRequested) {
    const handshake = mocks.startOptions?.shutdown
    if (!handshake) throw new Error('start did not hand core a shutdown handshake')
    handshake.onRequest()
  }
  const code = await instance.finished
  expect(mocks.removed).toBe(removalsBefore + 1)
  return code
}

/** 信号路径：收尾由信号处理器发起，用例只等结果。 */
async function stopViaSignal(run: Promise<RunningInstance> | RunningInstance, signal: string): Promise<number> {
  const instance = await run
  addedListeners(signal).at(-1)!(signal)
  return stopAndWait(instance, true)
}

beforeEach(() => {
  baseline = trackListeners()
  mocks.webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-cli-web-'))
  fs.writeFileSync(path.join(mocks.webRoot, 'index.html'), '<!doctype html>')
  mocks.proxyHost = '127.0.0.1'
  mocks.proxyPort = 9300
  mocks.startOptions = null
  mocks.startError = null
  mocks.stopError = null
  mocks.startCount = 0
  mocks.stopCount = 0
  mocks.removed = 0
  mocks.written = []
  mocks.previous = null
  mocks.alive = false
  mocks.writeError = null
  mocks.syncError = null
  mocks.syncStops = 0

  stdout = []
  stderr = []
  // 文案要钉死：`native-i18n` 是真实模块，本机语言是中文时这些断言会全红。
  vi.stubEnv('LC_ALL', 'en_US.UTF-8')
  vi.stubEnv('LC_MESSAGES', '')
  vi.stubEnv('LANG', '')
  applySystemLocale()

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(`${args.map(String).join(' ')}\n`)
  })
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    stderr.push(`${args.map(String).join(' ')}\n`)
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(`${args.map(String).join(' ')}\n`)
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(() => {
  restoreListeners(baseline)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('refusals before anything is started', () => {
  it('refuses to start when the console assets are missing', async () => {
    // 缺产物时静默降级成「只跑 API」，用户会以为服务坏了。`--no-web` 才是明确表达。
    mocks.webRoot = path.join(DATA_DIRECTORY, 'no-such-web')

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(mocks.startCount).toBe(0)
    expect(stderr.join('')).toContain(`Console assets are missing at ${mocks.webRoot}`)
  })

  it('does not look for the assets when the console is turned off', async () => {
    mocks.webRoot = path.join(DATA_DIRECTORY, 'no-such-web')

    const finished = await launch({ serveWeb: false })
    expect(await stopAndWait(finished)).toBe(0)
  })
})

describe('a successful start', () => {
  it('hands core the same data directory, runtime config and a shutdown handshake', async () => {
    const finished = await launch({ host: '0.0.0.0', proxyPort: 9400, managementPort: 9401 })
    expect(await stopAndWait(finished)).toBe(0)

    const options = mocks.startOptions!
    expect(options.runtimeConfig.dataDir).toBe(DATA_DIRECTORY)
    expect(options.runtimeConfig.runtime).toBe('cli')
    expect(options.runtimeConfig.environment).toBe('production')
    expect(options.runtimeConfig.appVersion).toBe(__CLI_VERSION__)
    expect(options.runtimeConfig.proxyHost).toBe('0.0.0.0')
    expect(options.runtimeConfig.proxyPort).toBe(9400)
    expect(options.runtimeConfig.managementPort).toBe(9401)
    expect(options.runtimeConfig.serveWeb).toBe(true)
    expect(options.runtimeConfig.webRoot).toBe(mocks.webRoot)
    // 桌面形态不传这个：交出收尾权是命令行专有的（`stop` 靠它停掉另一个进程）。
    expect(options.shutdown?.onRequest).toBeTypeOf('function')
    // 命令行拿不到系统钥匙串，只能用文件加密那一份实现。
    expect(options.secretStore.constructor.name).toBe('EncryptedFileSecretStore')
  })

  it('writes the runtime state as soon as the listeners are up', async () => {
    // 这份文件是 `stop` / `status` 唯一的线索；写晚了或者写错端口，它们就找不到实例。
    const finished = await launch()
    await stopAndWait(finished)

    expect(mocks.written).toHaveLength(1)
    expect(mocks.written[0]).toMatchObject({
      pid: process.pid,
      appVersion: __CLI_VERSION__,
      environment: 'production',
      managementHost: '127.0.0.1',
      managementPort: 9301,
      proxyHost: '127.0.0.1',
      proxyPort: 9300,
      webUrl: 'http://127.0.0.1:9301',
    })
    expect(Date.parse(mocks.written[0]!.startedAt)).not.toBeNaN()
  })

  it('prints the addresses it actually listens on', async () => {
    const finished = await launch()
    expect(await stopAndWait(finished)).toBe(0)

    const output = stdout.join('')
    expect(output).toContain(`OSW ${__CLI_VERSION__} (production)`)
    expect(output).toContain('Console: http://127.0.0.1:9301')
    expect(output).toContain('Proxy: http://127.0.0.1:9300')
    expect(output).toContain(`Data dir: ${DATA_DIRECTORY}`)
    expect(output).toContain('Press Ctrl+C to stop.')
  })

  it('takes the proxy address from the running server, not from the request', async () => {
    // 代理端口是设置项，用户可能改过；报出请求里的那个值等于报一个不存在的地址。
    mocks.proxyHost = '127.0.0.1'
    mocks.proxyPort = 9999

    const finished = await launch({ proxyPort: 9400 })
    expect(await stopAndWait(finished)).toBe(0)

    expect(stdout.join('')).toContain('Proxy: http://127.0.0.1:9999')
    expect(stdout.join('')).not.toContain('9400')
  })

  it('says the console is off when it does not host one', async () => {
    const finished = await launch({ serveWeb: false })
    expect(await stopAndWait(finished)).toBe(0)

    const output = stdout.join('')
    expect(output).toContain('Management: http://127.0.0.1:9301/api')
    expect(output).toContain('Console hosting is disabled (--no-web); only the HTTP API is served.')
    expect(output).not.toContain('Console: http')
    expect(mocks.startOptions!.runtimeConfig.webRoot).toBeNull()
  })

  it('warns on stderr when the proxy is reachable from the network', async () => {
    mocks.proxyHost = '0.0.0.0'

    const finished = await launch({ host: '0.0.0.0' })
    expect(await stopAndWait(finished)).toBe(0)

    // 判断必须落在监听地址上：`0.0.0.0` 归一化成回环之后看着像本机，实际全网可达。
    expect(stderr.join('')).toContain('Warning: the proxy listens on 0.0.0.0')
    // 警告不能挤进 stdout：那几行是「服务起来了吗」的答案。
    expect(stdout.join('')).not.toContain('Warning:')
  })

  it('keeps a loopback-only proxy quiet', async () => {
    const finished = await launch({ host: '127.0.0.1' })
    await stopAndWait(finished)

    // 只看代理暴露那句：stderr 上还可能躺着 Node 自己的原生警告，那些不归这里管。
    expect(stderr.join('')).not.toContain('Warning: the proxy')
  })
})

describe('stale runtime files from an earlier run', () => {
  it('clears one whose process is gone, and says so', async () => {
    mocks.previous = { pid: 4242 } as RuntimeFileState
    mocks.alive = false

    const finished = await launch()
    await stopAndWait(finished)

    expect(mocks.removed).toBeGreaterThanOrEqual(2)
    expect(stderr.join('')).toContain('[cli] cleared a stale runtime file from pid 4242')
  })

  it('leaves one behind when its process is still around', async () => {
    // 另一个实例可能是桌面端；删掉它的记录等于让它失去身份，`stop` 再也找不到它。
    mocks.previous = { pid: 4242 } as RuntimeFileState
    mocks.alive = true

    const finished = await launch()
    await stopAndWait(finished)

    expect(stderr.join('')).not.toContain('stale runtime file')
  })

  it('starts anyway when the stale file cannot be removed', async () => {
    // 尽力而为：后面的原子写会覆盖它，为此拒绝启动得不偿失。
    mocks.previous = { pid: 4242 } as RuntimeFileState
    mocks.alive = false

    const finished = await launch()
    await stopAndWait(finished)

    expect(mocks.startCount).toBe(1)
  })
})

describe('startup failures', () => {
  it('reports the holder of the instance lock as an already-running instance', async () => {
    mocks.startError = new InstanceLockError({ pid: 7, startedAt: '2026-09-11T00:00:00.000Z' }, '/tmp/instance.lock')

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain(`An instance is already running (pid 7, data directory ${DATA_DIRECTORY}).`)
    expect(stderr.join('')).toContain('Run osw stop first')
    // 还没起来，就不该留下一份假的运行时文件。
    expect(mocks.written).toHaveLength(0)
  })

  it('reports an unreadable lock as unknown rather than as a running instance', async () => {
    // 「读不出来」与「有人在跑」要是同一句话，用户会去 `stop` 一个不存在的实例。
    mocks.startError = new InstanceLockError(null, '/tmp/instance.lock')

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Cannot tell whether /tmp/instance.lock is in use')
    expect(stderr.join('')).not.toContain('already running')
  })

  it('names the occupied address when a port is taken', async () => {
    mocks.startError = Object.assign(new Error('listen EADDRINUSE'), {
      code: 'EADDRINUSE',
      address: '127.0.0.1',
      port: 9300,
    })

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Cannot start OSW: 127.0.0.1:9300 is already in use.')
    expect(stderr.join('')).toContain('Stop the process that holds the port')
  })

  it('falls back to the management address when the error does not carry one', async () => {
    mocks.startError = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Cannot start OSW: 127.0.0.1:9301 is already in use.')
  })

  it('reports anything else as a plain start failure', async () => {
    mocks.startError = new Error('the database is locked')

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Failed to start OSW: the database is locked')
  })

  it('shuts the server back down when the runtime file cannot be written', async () => {
    // 「起得来但停不掉」比启动失败难收拾得多，而且它还会继续占着端口。
    mocks.writeError = new Error('read-only file system')

    const code = await runStart(cliArguments())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Failed to start OSW: read-only file system')
    // 写不进去就当作启动失败，并且必须把刚起来的服务收回去。
    expect(mocks.stopCount).toBe(1)
    expect(mocks.startCount).toBe(1)
  })
})

describe('language sync', () => {
  it('keeps running when the settings cannot be read', async () => {
    // 已经跑起来的服务不该为了一句取词被打断，终端继续用系统语言。
    mocks.syncError = new Error('settings unavailable')

    const finished = await launch()
    expect(await stopAndWait(finished)).toBe(0)

    expect(stderr.join('')).toContain('[cli] language sync unavailable, using the system locale')
    expect(stdout.join('')).toContain('Press Ctrl+C to stop.')
  })

  it('stops following the settings once the service is down', async () => {
    const finished = await launch()
    expect(await stopAndWait(finished)).toBe(0)

    expect(mocks.syncStops).toBe(1)
  })
})

describe('shutdown', () => {
  it('comes down on SIGINT and reports success', async () => {
    expect(await stopViaSignal(launch(), 'SIGINT')).toBe(0)
  })

  it('comes down on SIGTERM as well', async () => {
    expect(await stopViaSignal(launch(), 'SIGTERM')).toBe(0)
  })

  it('only shuts down once even when the signal and the handshake race', async () => {
    // 两个收尾并发跑会让 `removeRuntimeState` 之类的东西互相踩。
    const instance = await launch()
    const handler = addedListeners('SIGINT').at(-1)!
    handler('SIGINT')
    handler('SIGINT')

    expect(await stopAndWait(instance, true)).toBe(0)
    // 只清一次：第二次请求必须被 `stopping` 挡掉。
    expect(mocks.removed).toBe(1)
    expect(mocks.stopCount).toBe(1)
  })

  it('still exits cleanly when the graceful stop fails', async () => {
    // 已经决定要退出了，卡在收尾上比退得不够漂亮严重得多。
    mocks.stopError = new Error('the management service already went away')

    const finished = await launch()
    expect(await stopAndWait(finished)).toBe(0)

    expect(stderr.join('')).toContain('[cli] graceful shutdown failed')
  })
})

describe('crash fallback', () => {
  it('cleans up the runtime file before exiting on an uncaught exception', async () => {
    const finished = await launch()
    await stopAndWait(finished)

    const exits: number[] = []
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code ?? 0)
      return undefined as never
    }) as never)

    const fatal = addedListeners('uncaughtException').at(-1)!
    mocks.removed = 0

    // 真等 5 秒兜底定时器不划算；这里只关心「清理先做、然后退」这个顺序。
    vi.useFakeTimers()
    try {
      fatal(new Error('boom'))
      await vi.advanceTimersByTimeAsync(5_000)
    } finally {
      vi.useRealTimers()
    }

    expect(stderr.join('')).toContain('[cli] uncaughtException')
    expect(mocks.removed).toBe(1)
    expect(exits).toContain(1)
  })

  it('publishes a handler for unhandled rejections too', async () => {
    const finished = await launch()
    await stopAndWait(finished)

    expect(addedListeners('unhandledRejection')).toHaveLength(1)
  })
})
