import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeFileState } from '../runtime-state'
import { applySystemLocale } from '../native-i18n'
import { runStatus } from './status'

/**
 * `status`：报告另一个进程的状态。
 *
 * 这个命令的性质决定了它有三条不能破的规矩，用例就是守这三条：
 *   1. **只读**——不清理失效的运行时文件（那是 `stop` 的活）；
 *   2. **布局固定**——数据缺失用 `—` 占位，而不是少打几行；
 *   3. **两种输出同源**——`--json` 与文本都从同一份 `InstanceReport` 渲染。
 * 另外把「无响应」再拆一层：「端口根本没起来」与「端口在听但不回话」给用户的
 * 下一步完全不同。
 */

const mocks = vi.hoisted(() => ({
  state: null as RuntimeFileState | null,
  alive: false,
  probe: { ok: false, reason: 'unreachable' } as unknown,
  portListening: false,
  removed: 0,
}))

vi.mock('../runtime-state', () => ({
  runtimeFilePath: (dataDirectory: string) => `${dataDirectory}/runtime.json`,
  readRuntimeState: async () => mocks.state,
  removeRuntimeState: async () => {
    mocks.removed += 1
  },
  isProcessAlive: () => mocks.alive,
}))

vi.mock('../management-client', () => ({
  callManagementApi: async () => mocks.probe,
  isPortListening: async () => mocks.portListening,
}))

function runtimeState(overrides: Partial<RuntimeFileState> = {}): RuntimeFileState {
  return {
    pid: 4242,
    appVersion: __CLI_VERSION__,
    environment: 'production',
    managementHost: '127.0.0.1',
    managementPort: 9301,
    proxyHost: '127.0.0.1',
    proxyPort: 9300,
    webUrl: 'http://127.0.0.1:9301',
    startedAt: '2026-09-11T00:00:00.000Z',
    ...overrides,
  }
}

let stdout: string[]
let stderr: string[]

beforeEach(() => {
  mocks.state = null
  mocks.alive = false
  mocks.probe = { ok: false, reason: 'unreachable' }
  mocks.portListening = false
  mocks.removed = 0
  stdout = []
  stderr = []
  // 文案要钉死：跟着系统语言跑的话，这些断言会在别人的机器上红。
  vi.stubEnv('LC_ALL', 'en_US.UTF-8')
  vi.stubEnv('LC_MESSAGES', '')
  vi.stubEnv('LANG', '')
  applySystemLocale()
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(`${args.join(' ')}\n`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

interface RunOptions { dataDir?: string | null; json?: boolean }

async function run(options: RunOptions = {}) {
  const code = await runStatus({
    command: 'status',
    help: false,
    version: false,
    dataDir: options.dataDir ?? null,
    host: null,
    proxyPort: null,
    managementPort: null,
    serveWeb: true,
    json: options.json ?? false,
  })
  return { code, text: stdout.join(''), errors: stderr.join('') }
}

describe('runStatus without a runtime file', () => {
  it('reports a stopped instance and still prints the whole layout', async () => {
    const { code, text } = await run()

    expect(code).toBe(0)
    // 布局不随数据有无而变：九行、缺值一律 `—`。
    expect(text.trimEnd().split('\n')).toHaveLength(9)
    expect(text).toContain('not running')
    expect(text.match(/—/g)).toHaveLength(5)
  })

  it('never removes the runtime file it was told about', async () => {
    // 一个只读命令悄悄改磁盘上的东西，下次出问题时会让人怀疑「是不是 status 搞坏的」。
    await run()

    expect(mocks.removed).toBe(0)
  })
})

describe('runStatus with a live instance', () => {
  beforeEach(() => {
    mocks.state = runtimeState()
  })

  it('reports running when the management service answers', async () => {
    mocks.probe = { ok: true, data: { running: true, host: '0.0.0.0', port: 9400 } }

    const { code, text } = await run()

    expect(code).toBe(0)
    expect(text).toContain('running')
    // 代理实际生效的地址来自设置，可能与运行时文件里记的不同——以服务端说的为准。
    expect(text).toContain('127.0.0.1:9400')
    // 通配监听不是能连过去的地址，展示时必须落到回环上。
    expect(text).not.toContain('0.0.0.0')
  })

  it('keeps the recorded proxy address when the payload does not carry one', async () => {
    // 响应形状不对时不能把地址抹成 `—`：运行时文件里那份仍然是已知事实。
    mocks.probe = { ok: true, data: { running: true } }

    const { text } = await run()

    expect(text).toContain('127.0.0.1:9300')
  })

  it('survives a null payload', async () => {
    mocks.probe = { ok: true, data: null }

    const { code, text } = await run()

    expect(code).toBe(0)
    expect(text).toContain('running')
  })

  it('prints the instance version it reported', async () => {
    mocks.probe = { ok: true, data: { running: true } }
    mocks.state = runtimeState({ appVersion: '1.0.0' })

    const { text, errors } = await run()

    expect(text).toContain('1.0.0')
    // 版本漂移不给结论，只把两个事实摆出来。
    expect(errors).toContain(`the running instance is 1.0.0, this CLI is ${__CLI_VERSION__}`)
  })
})

describe('runStatus with an unresponsive instance', () => {
  beforeEach(() => {
    mocks.state = runtimeState()
    mocks.alive = true
    mocks.probe = { ok: false, reason: 'rejected', status: 404 }
  })

  it('distinguishes a closed management port from a listening one', async () => {
    mocks.portListening = false

    const { code, text, errors } = await run()

    expect(code).toBe(0)
    expect(text).toContain('not responding')
    // 进程活着但端口没开：多半是启动到一半失败了，这里点名说出来。
    expect(errors).toContain('nothing is listening on 127.0.0.1:9301')
  })

  it('stays quiet about the port when it is listening but silent', async () => {
    // 端口在听却不回话是另一种毛病，那句「端口没开」会把人指错方向。
    mocks.portListening = true

    const { errors } = await run()

    expect(errors).not.toContain('nothing is listening')
  })
})

describe('runStatus with a stale runtime file', () => {
  it('reports stopped, clears the dead pid, and says the file is stale', async () => {
    // 进程已消失、文件是残留：状态是事实上的「未运行」，但残留本身要说出来，
    // 免得用户看到「未运行」却还躺着一个文件。
    mocks.state = runtimeState()
    mocks.alive = false
    mocks.probe = { ok: false, reason: 'unreachable' }

    const { code, text, errors } = await run()

    expect(code).toBe(0)
    expect(text).toContain('not running')
    // 留着真实端口与死掉的 PID 会读成「其实在跑」，而且那个 pid 还能被脚本拿去用。
    expect(text).not.toContain('9301')
    expect(text).not.toContain('4242')
    expect(errors).toContain('[cli] stale runtime file:')
  })

  it('says nothing about staleness when there is no file at all', async () => {
    const { errors } = await run()

    expect(errors).not.toContain('stale runtime file')
  })
})

describe('--json output', () => {
  it('is parseable and carries the same facts as the text output', async () => {
    mocks.state = runtimeState()
    mocks.alive = true
    mocks.probe = { ok: true, data: { running: true, host: '127.0.0.1', port: 9300 } }

    const { text, errors } = await run({ json: true })
    const report = JSON.parse(text) as Record<string, unknown>

    expect(report.state).toBe('running')
    expect(report.cliVersion).toBe(__CLI_VERSION__)
    expect(report.instanceVersion).toBe(__CLI_VERSION__)
    expect(report.pid).toBe(4242)
    expect(report.management).toEqual({ host: '127.0.0.1', port: 9301, url: 'http://127.0.0.1:9301' })
    expect(report.proxy).toEqual({ host: '127.0.0.1', port: 9300, url: 'http://127.0.0.1:9300' })
    expect(report.consoleUrl).toBe('http://127.0.0.1:9301')
    expect(report.staleRuntimeFile).toBe(false)
    // 文本布局不该出现在 stdout：脚本要能直接把它喂给 JSON.parse。
    expect(text).not.toContain('State:')
    // 诊断行仍然只走 stderr。
    expect(errors).toBe('')
  })

  it('uses null rather than the dash placeholder for missing fields', async () => {
    const { text } = await run({ json: true })
    const report = JSON.parse(text) as Record<string, unknown>

    expect(report.state).toBe('stopped')
    // `—` 那个占位符只属于给人看的文本输出。
    expect(report.pid).toBeNull()
    expect(report.startedAt).toBeNull()
    expect(report.management).toBeNull()
    expect(report.proxy).toBeNull()
    expect(report.portListening).toBeNull()
    expect(text).not.toContain('—')
  })
})

describe('data directory', () => {
  it('resolves the given path instead of the default one', async () => {
    const { text } = await run({ dataDir: './relative-dir', json: true })
    const report = JSON.parse(text) as Record<string, unknown>

    // 之后的日志与运行时文件都按绝对路径说话，报告里也该是同一个。
    expect(report.dataDir).toMatch(/relative-dir$/)
    expect(String(report.dataDir)).toMatch(/^[A-Za-z]:[\\/]|^\//)
  })
})
