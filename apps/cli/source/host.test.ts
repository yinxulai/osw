import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRuntimeProfile } from '@common/runtime-profile'
import {
  CLI_RUNTIME_ENVIRONMENT,
  DATA_DIRECTORY_ENVIRONMENT_VARIABLE,
  connectHost,
  defaultDataDirectory,
  effectiveDefaultDataDirectory,
  formatEndpoint,
  formatHostForDisplay,
  formatUrl,
  isLoopbackHost,
  resolveDataDirectory,
} from './host'

// 地址归一化是「看着对但容易写反」的一类逻辑：`0.0.0.0` 归一化成回环之后看着像本机，
// 实际全网可达。用例把「连接用」与「判断用」两个方向分开钉死，防止哪天有人把它们合并。

describe('connectHost', () => {
  it('falls back to loopback for wildcard listeners', () => {
    expect(connectHost('0.0.0.0')).toBe('127.0.0.1')
    expect(connectHost('::')).toBe('::1')
    expect(connectHost('::0')).toBe('::1')
    expect(connectHost('[::]')).toBe('::1')
  })

  it('strips the brackets an IPv6 literal may arrive with', () => {
    // `net.connect` 与 fetch 要的是裸地址，方括号只属于拼接后的主机段。
    expect(connectHost('[::1]')).toBe('::1')
    expect(connectHost('[fe80::1]')).toBe('fe80::1')
    expect(connectHost('::1')).toBe('::1')
  })

  it('leaves ordinary hosts untouched', () => {
    expect(connectHost('127.0.0.1')).toBe('127.0.0.1')
    expect(connectHost('192.168.1.9')).toBe('192.168.1.9')
    expect(connectHost('localhost')).toBe('localhost')
  })
})

describe('formatHostForDisplay', () => {
  it('adds brackets only where a URL needs them', () => {
    expect(formatHostForDisplay('::1')).toBe('[::1]')
    expect(formatHostForDisplay('0.0.0.0')).toBe('127.0.0.1')
    expect(formatHostForDisplay('::')).toBe('[::1]')
    expect(formatHostForDisplay('127.0.0.1')).toBe('127.0.0.1')
  })
})

describe('formatUrl / formatEndpoint', () => {
  it('builds connectable URLs', () => {
    expect(formatEndpoint('127.0.0.1', 9_300)).toBe('127.0.0.1:9300')
    expect(formatUrl('127.0.0.1', 9_300)).toBe('http://127.0.0.1:9300')
    expect(formatUrl('0.0.0.0', 9_300)).toBe('http://127.0.0.1:9300')
    expect(formatUrl('::', 9_300)).toBe('http://[::1]:9300')
  })
})

describe('isLoopbackHost', () => {
  it('accepts every spelling of the local host', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('127.1.2.3')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('LOCALHOST')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true)
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects the wildcard address', () => {
    // 这就是它不复用 `connectHost` 的原因：归一化之后 `0.0.0.0` 会变成 `127.0.0.1`。
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('::')).toBe(false)
    expect(isLoopbackHost('')).toBe(false)
  })

  it('rejects addresses that are reachable from the network', () => {
    expect(isLoopbackHost('192.168.1.9')).toBe(false)
    expect(isLoopbackHost('10.0.0.1')).toBe(false)
    expect(isLoopbackHost('fe80::1')).toBe(false)
    // 前缀相近但不是回环：别用 startsWith('127') 这种写法。
    expect(isLoopbackHost('1270.0.0.1')).toBe(false)
    expect(isLoopbackHost('::ffff:192.168.1.9')).toBe(false)
  })
})

// 数据目录是「两种形态共用同一份数据」的全部依据：命令行必须落在桌面形态那个目录里，
// 差一个大小写就是两套空数据。
describe('defaultDataDirectory', () => {
  it('lands directly under the home directory', () => {
    // 目录名只能来自预设：Linux 上曾经写死成小写的 `osw`，与桌面形态的
    // `OSW` 分叉成两个目录（见 `apps/docs/specs/platform/packaging.md` §5.5）。
    expect(defaultDataDirectory()).toBe(path.join(os.homedir(), getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT).dataDirectoryName))
    expect(path.dirname(defaultDataDirectory())).toBe(os.homedir())
  })

  it('uses the production profile directory of the desktop form', () => {
    expect(getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT).dataDirectoryName).toBe(getRuntimeProfile('production').dataDirectoryName)
  })

  it('is an absolute path', () => {
    expect(path.isAbsolute(defaultDataDirectory())).toBe(true)
  })
})

// 环境变量是给「启动命令不由人手输」的形态准备的（systemd unit、docker run），
// 所以它的优先级必须钉死：显式参数 > 环境 > 平台默认。
describe('resolveDataDirectory', () => {
  const withEnvironment = (value: string | undefined, run: () => void): void => {
    const previous = process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE]
    if (value === undefined) delete process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE]
    else process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE] = value
    try {
      run()
    } finally {
      if (previous === undefined) delete process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE]
      else process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE] = previous
    }
  }

  it('falls back to the platform default when nothing is configured', () => {
    withEnvironment(undefined, () => {
      expect(resolveDataDirectory(null)).toBe(defaultDataDirectory())
      expect(effectiveDefaultDataDirectory()).toBe(defaultDataDirectory())
    })
  })

  it('uses the environment variable when --data-dir is absent', () => {
    withEnvironment(path.join(os.tmpdir(), 'osw-from-environment'), () => {
      expect(resolveDataDirectory(null)).toBe(path.join(os.tmpdir(), 'osw-from-environment'))
      expect(effectiveDefaultDataDirectory()).toBe(path.join(os.tmpdir(), 'osw-from-environment'))
    })
  })

  it('lets --data-dir win over the environment variable', () => {
    // 环境变量常是全局设的，而显式参数是「就这一次」的意思。
    withEnvironment(path.join(os.tmpdir(), 'osw-from-environment'), () => {
      expect(resolveDataDirectory(path.join(os.tmpdir(), 'osw-from-flag'))).toBe(
        path.join(os.tmpdir(), 'osw-from-flag'),
      )
    })
  })

  it('treats a blank environment variable as unset', () => {
    // `OSW_DATA_DIR=` 在 systemd 与 shell 里都很常见；把它当成空路径会
    // `path.resolve('')` 成当前目录，服务就会在启动目录下建库。
    withEnvironment('   ', () => {
      expect(resolveDataDirectory(null)).toBe(defaultDataDirectory())
    })
  })

  it('resolves a relative environment value to an absolute path', () => {
    withEnvironment('relative-osw-dir', () => {
      expect(path.isAbsolute(resolveDataDirectory(null))).toBe(true)
      expect(resolveDataDirectory(null)).toBe(path.resolve('relative-osw-dir'))
    })
  })
})
