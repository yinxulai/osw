/**
 * 命令行入口：解析 → 分发 → 定退出码。
 *
 * 入口的副作用在 import 时就发生了（`main(process.argv.slice(2))`），所以每个用例都
 * 重置模块、摆好 `process.argv` 再 import 一次。要守的三条：
 *   - 退出码只表达三件事：0 成功、1 执行失败、2 用法错误。脚本靠它分支。
 *   - 用法错误（未知命令/选项、取值非法、`--json` 用错地方）一律 **2**，不能混成 1；
 *     否则「命令写错了」与「服务真失败了」在 CI 里分不开。
 *   - `--help` / `--version` 优先于命令：`osw start --help` 想看的是帮助，不是把服务跑起来。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  started: [] as unknown[],
  stopped: [] as unknown[],
  statuses: [] as unknown[],
  helpRenders: 0,
  code: 0,
}))

vi.mock('./commands/start', () => ({
  runStart: async (values: unknown) => {
    mocks.started.push(values)
    return mocks.code
  },
}))

vi.mock('./commands/stop', () => ({
  runStop: async (values: unknown) => {
    mocks.stopped.push(values)
    return mocks.code
  },
}))

vi.mock('./commands/status', () => ({
  runStatus: async (values: unknown) => {
    mocks.statuses.push(values)
    return mocks.code
  },
}))

vi.mock('./commands/help', () => ({
  renderHelp: () => {
    mocks.helpRenders += 1
    return 'USAGE-PLACEHOLDER'
  },
}))

let stdout: string[]
let stderr: string[]

/** 摆好 argv 并 import 入口；返回等待退出码落地的 promise。 */
async function runCli(args: string[]): Promise<number> {
  process.argv = [process.argv[0]!, process.argv[1]!, ...args]
  vi.resetModules()
  await import('./index')
  const deadline = Date.now() + 3_000
  while (process.exitCode === null || process.exitCode === undefined) {
    if (Date.now() > deadline) throw new Error('the entry point never settled an exit code')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return process.exitCode
}

beforeEach(() => {
  mocks.started = []
  mocks.stopped = []
  mocks.statuses = []
  mocks.helpRenders = 0
  mocks.code = 0
  stdout = []
  stderr = []
  // 文案要钉死：入口用的是真实的 `native-i18n`，本机语言是中文时断言会全红。
  vi.stubEnv('LC_ALL', 'en_US.UTF-8')
  vi.stubEnv('LC_MESSAGES', '')
  vi.stubEnv('LANG', '')
  process.exitCode = undefined
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    process.exitCode = code ?? 0
    return undefined as never
  }) as never)
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
})

describe('usage errors exit with 2', () => {
  it('rejects an unknown command', async () => {
    expect(await runCli(['frobnicate'])).toBe(2)
    expect(stderr.join('')).toContain('Unknown command: frobnicate')
    // 报错之后要跟一行用法，不然用户不知道正确的词是什么。
    expect(stderr.join('')).toContain('Usage: osw [command] [options]')
    expect(mocks.started).toHaveLength(0)
  })

  it('rejects an unknown option', async () => {
    expect(await runCli(['start', '--wat'])).toBe(2)
    expect(stderr.join('')).toContain('Unknown option: --wat')
  })

  it('rejects an option that is missing its value', async () => {
    expect(await runCli(['start', '--data-dir'])).toBe(2)
    expect(stderr.join('')).toContain('--data-dir requires a value')
  })

  it('rejects a port that is not a port', async () => {
    expect(await runCli(['start', '--proxy-port', '99999'])).toBe(2)
    expect(stderr.join('')).toContain('--proxy-port must be an integer between 1 and 65535')
  })

  it('refuses --json on a command that has no JSON output', async () => {
    // 静默忽略会让写 `start --json` 的人以为拿到了机器可读输出。
    expect(await runCli(['start', '--json'])).toBe(2)
    expect(stderr.join('')).toContain('--json only applies to status')
  })

  it('accepts --json on status', async () => {
    expect(await runCli(['status', '--json'])).toBe(0)
    expect(mocks.statuses).toHaveLength(1)
  })
})

describe('dispatching', () => {
  it('defaults to start when no command is given', async () => {
    // `osw` 等价于 `osw start`。
    expect(await runCli([])).toBe(0)
    expect(mocks.started).toHaveLength(1)
    expect(mocks.stopped).toHaveLength(0)
  })

  it('passes the parsed arguments through', async () => {
    expect(await runCli(['start', '--host', '0.0.0.0', '--proxy-port', '9400', '--no-web', '--data-dir', '/tmp/x'])).toBe(0)

    expect(mocks.started[0]).toMatchObject({
      command: 'start',
      host: '0.0.0.0',
      proxyPort: 9400,
      serveWeb: false,
      dataDir: '/tmp/x',
    })
  })

  it('routes stop and status', async () => {
    expect(await runCli(['stop'])).toBe(0)
    expect(await runCli(['status'])).toBe(0)

    expect(mocks.stopped).toHaveLength(1)
    expect(mocks.statuses).toHaveLength(1)
  })

  it('propagates the exit code the command returned', async () => {
    // 脚本靠这个码判断要不要重试，入口不能把它改成「能起来就算成功」。
    mocks.code = 1

    expect(await runCli(['stop'])).toBe(1)
  })

  it('prints the bare version number for `version`', async () => {
    // 只有版本号、没有前缀：它要能被脚本直接取用。
    expect(await runCli(['version'])).toBe(0)
    expect(stdout.join('')).toBe(`${__CLI_VERSION__}\n`)
  })
})

describe('help and version win over the command', () => {
  it('shows help instead of starting the service', async () => {
    // `osw start --help` 想看的是帮助，不是把服务跑起来。
    expect(await runCli(['start', '--help'])).toBe(0)

    expect(mocks.helpRenders).toBe(1)
    expect(stdout.join('')).toContain('USAGE-PLACEHOLDER')
    expect(mocks.started).toHaveLength(0)
  })

  it('still reports a mistyped command even when --help is present', async () => {
    // 解析器会扫完全部 token：`frobnicate` 判成未知命令之后就是用法错误，`--help` 救不回来。
    // 这是想要的结果——报出拼错的那个词，比把它埋进一屏帮助里更有用。
    expect(await runCli(['frobnicate', '--help'])).toBe(2)
    expect(await runCli(['--help', 'frobnicate'])).toBe(2)

    expect(stderr.join('')).toContain('Unknown command: frobnicate')
    expect(mocks.helpRenders).toBe(0)
  })

  it('prints the version without the command running', async () => {
    expect(await runCli(['start', '--version'])).toBe(0)

    expect(stdout.join('')).toBe(`${__CLI_VERSION__}\n`)
    expect(mocks.started).toHaveLength(0)
  })

  it('prefers help when both are asked for', async () => {
    expect(await runCli(['--version', '--help'])).toBe(0)

    expect(mocks.helpRenders).toBe(1)
    expect(stdout.join('')).toContain('USAGE-PLACEHOLDER')
  })
})
