import { describe, expect, it } from 'vitest'
import { CLI_COMMANDS, parseArguments } from './options'

// 解析器是纯函数，用例只喂 argv、只看返回值。错误是数据（目录 key + 插值参数），
// 所以断言落在 key 上，而不是渲染好的句子上——句子属于目录，会随翻译改。

function expectOk(argv: readonly string[]) {
  const result = parseArguments(argv)
  if (!result.ok) throw new Error(`expected success, got ${result.error.key}`)
  return result.values
}

function expectError(argv: readonly string[]) {
  const result = parseArguments(argv)
  if (result.ok) throw new Error('expected a parse error')
  return result.error
}

describe('parseArguments', () => {
  it('defaults to start with console hosting on', () => {
    expect(expectOk([])).toEqual({
      command: 'start',
      help: false,
      version: false,
      dataDir: null,
      host: null,
      proxyPort: null,
      managementPort: null,
      // 管理面监听地址缺省是 `null`（= 跟随 `--host` 那套默认），不是 `127.0.0.1`：
      // 写死一个回环地址会把「用户给了 --management-port 却在服务器上」这种组合变得无解。
      managementHost: null,
      serveWeb: true,
      json: false,
      positionals: [],
      passwordStdin: false,
    })
  })

  it('accepts every declared command', () => {
    for (const command of CLI_COMMANDS) {
      expect(expectOk([command]).command).toBe(command)
    }
  })

  it('accepts both --option=value and --option value', () => {
    const inline = expectOk(['start', '--proxy-port=18080', '--management-port=18081'])
    const spaced = expectOk(['start', '--proxy-port', '18080', '--management-port', '18081'])

    expect(inline).toMatchObject({ proxyPort: 18080, managementPort: 18081 })
    expect(spaced).toMatchObject({ proxyPort: 18080, managementPort: 18081 })
  })

  it('treats --help and --version as global flags', () => {
    expect(expectOk(['-h'])).toMatchObject({ help: true, command: 'start' })
    expect(expectOk(['--help', 'stop'])).toMatchObject({ help: true, command: 'stop' })
    expect(expectOk(['--version'])).toMatchObject({ version: true })
    expect(expectOk(['-v'])).toMatchObject({ version: true })
  })

  it('keeps the last --web / --no-web spelling', () => {
    expect(expectOk(['start', '--no-web', '--web']).serveWeb).toBe(true)
    expect(expectOk(['start', '--web', '--no-web']).serveWeb).toBe(false)
  })

  it('accepts --json as a bare flag', () => {
    expect(expectOk(['status', '--json']).json).toBe(true)
    expect(expectOk(['status']).json).toBe(false)
    // `--json` 是开关，没有取值。`--json=true` 这类写法一律按未知选项拒掉：
    // 一旦接受它，就会有人去猜 `--json=false` 能不能关掉。`--web` 同一条规则。
    expect(expectError(['status', '--json=true']).key).toBe('native.cli.error.unknownOption')
  })

  it('passes the data directory through untouched', () => {
    expect(expectOk(['start', '--data-dir', 'D:\\one switch']).dataDir).toBe('D:\\one switch')
    expect(expectOk(['start', '--data-dir=/tmp/os']).dataDir).toBe('/tmp/os')
  })

  it('ignores the option terminator', () => {
    expect(expectOk(['start', '--'])).toMatchObject({ command: 'start' })
    // 终止符之后的位置参数仍是位置参数，多出来的那个照旧报错。
    expect(expectError(['start', '--', 'extra']).key).toBe('native.cli.error.unknownCommand')
  })

  it('rejects a second positional argument', () => {
    expect(expectError(['start', 'stop']).params).toEqual({ command: 'stop' })
  })

  it('rejects unknown commands', () => {
    expect(expectError(['serve']).key).toBe('native.cli.error.unknownCommand')
    expect(expectError(['serve']).params).toEqual({ command: 'serve' })
  })

  it('rejects unknown options by name, not by the whole token', () => {
    expect(expectError(['--nope']).params).toEqual({ option: '--nope' })
    expect(expectError(['--nope=1']).params).toEqual({ option: '--nope' })
  })

  it('rejects a value attached to a flag that takes none', () => {
    expect(expectError(['-h=1']).params).toEqual({ option: '-h=1' })
    expect(expectError(['--web=1']).params).toEqual({ option: '--web=1' })
  })

  it('rejects a missing value', () => {
    expect(expectError(['--data-dir']).key).toBe('native.cli.error.missingValue')
    expect(expectError(['--host=']).key).toBe('native.cli.error.missingValue')
  })

  it('rejects ports that are not plain decimal integers in range', () => {
    for (const value of ['0', '65536', '0x1f90', '1e4', ' 80', '80.5', '080x']) {
      const error = expectError(['--proxy-port', value])
      expect(error.key).toBe('native.cli.error.invalidPort')
      expect(error.params).toEqual({ option: '--proxy-port', value })
    }
  })

  it('accepts the boundary ports', () => {
    expect(expectOk(['--proxy-port', '1']).proxyPort).toBe(1)
    expect(expectOk(['--proxy-port', '65535']).proxyPort).toBe(65535)
  })

  it('returns a fresh object per call', () => {
    const first = expectOk(['start', '--host', '0.0.0.0'])
    const second = expectOk([])

    expect(first.host).toBe('0.0.0.0')
    expect(second.host).toBeNull()
  })
})
