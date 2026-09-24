import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandDeclaredPath, resolveClientConfigPath } from './paths'

/**
 * 路径解析——整个功能的**安全边界**。
 *
 * 管理 API 没有鉴权（只绑回环 + CORS 白名单，见 `docs/product/security-privacy.md`），
 * 所以「能写哪个文件」这件事只能由注册表说了算：调用方给的是「客户端 key + 声明过的那条路径」，
 * 两者对不上就没有路径可写。下面一半的断言其实是**否定断言**：越界、猜测、拼路径都必须拿到 `null`。
 */

const home = resolve('osw-test-home')
const configHome = resolve('osw-test-xdg-config')
const dataHome = resolve('osw-test-xdg-data')
const opencodeConfigFile = { name: 'XDG_CONFIG_HOME', replaces: '~/.config' }
const opencodeAuthFile = { name: 'XDG_DATA_HOME', replaces: '~/.local/share' }

describe('expandDeclaredPath', () => {
  it('falls back to the home directory when no environment variable is declared', () => {
    expect(expandDeclaredPath('~/.claude/settings.json', undefined, home, {})).toBe(join(home, '.claude', 'settings.json'))
  })

  it('replaces exactly the prefix the variable declares', () => {
    const config = expandDeclaredPath(
      '~/.config/opencode/opencode.json',
      opencodeConfigFile,
      home,
      { XDG_CONFIG_HOME: configHome },
    )
    const data = expandDeclaredPath(
      '~/.local/share/opencode/auth.json',
      opencodeAuthFile,
      home,
      { XDG_DATA_HOME: dataHome },
    )

    expect(config).toBe(join(configHome, 'opencode', 'opencode.json'))
    // XDG_DATA_HOME 换掉的是两层（`~/.local/share`），少换一层会把 `share` 漏进真实路径里。
    expect(data).toBe(join(dataHome, 'opencode', 'auth.json'))
  })

  it('keeps the variable out of the path when it is missing or blank', () => {
    expect(expandDeclaredPath('~/.config/opencode/opencode.json', opencodeConfigFile, home, {})).toBe(
      join(home, '.config', 'opencode', 'opencode.json'),
    )
    expect(
      expandDeclaredPath('~/.config/opencode/opencode.json', opencodeConfigFile, home, { XDG_CONFIG_HOME: '   ' }),
    ).toBe(join(home, '.config', 'opencode', 'opencode.json'))
  })

  it('ignores a variable whose declared prefix does not match the path', () => {
    // `replaces` 写错属于注册表的数据问题（由 `clients.test.ts` 兜住）；运行时宁可退回主目录，
    // 也不要把写入目标指到一个谁也没预期的地方。
    expect(
      expandDeclaredPath('~/.local/share/opencode/auth.json', opencodeConfigFile, home, { XDG_CONFIG_HOME: configHome }),
    ).toBe(join(home, '.local', 'share', 'opencode', 'auth.json'))
  })

  it('does not treat a sibling directory with the same prefix as a match', () => {
    // `~/.configuration/...` 不该被 `~/.config` 命中。
    const envVar = { name: 'XDG_CONFIG_HOME', replaces: '~/.config' }
    expect(expandDeclaredPath('~/.configuration/x.json', envVar, home, { XDG_CONFIG_HOME: configHome })).toBe(
      join(home, '.configuration', 'x.json'),
    )
  })

  it('tolerates trailing separators on the variable value', () => {
    expect(
      expandDeclaredPath('~/.config/opencode/opencode.json', opencodeConfigFile, home, { XDG_CONFIG_HOME: `${configHome}/` }),
    ).toBe(join(configHome, 'opencode', 'opencode.json'))
  })

  it('refuses a declared path that is not home-relative', () => {
    expect(() => expandDeclaredPath('/etc/passwd', undefined, home, {})).toThrow(/must start with "~\/"/)
    expect(() => expandDeclaredPath('relative/x.json', undefined, home, {})).toThrow(/must start with "~\/"/)
  })
})

describe('resolveClientConfigPath', () => {
  it('expands a declared pair against the real home directory', () => {
    expect(resolveClientConfigPath('claude-code', '~/.claude/settings.json')).toBe(join(homedir(), '.claude', 'settings.json'))
  })

  it('expands an env-overridable path without asking the machine for anything', () => {
    // 这台机器上有没有配 XDG 都不影响结论：尾部形状是注册表里写死的那一段。
    const resolved = resolveClientConfigPath('opencode', '~/.config/opencode/opencode.json')
    expect(resolved?.endsWith(join('opencode', 'opencode.json'))).toBe(true)
  })

  it('refuses an unknown client', () => {
    expect(resolveClientConfigPath('not-a-client', '~/.claude/settings.json')).toBeNull()
  })

  it('refuses a path the client never declared', () => {
    expect(resolveClientConfigPath('claude-code', '~/.ssh/id_rsa')).toBeNull()
    // 同一份路径写给别的客户端也不行：可写集合是「客户端 × 声明路径」的笛卡尔配对，不是一张全局白名单。
    expect(resolveClientConfigPath('codex', '~/.claude/settings.json')).toBeNull()
  })

  it('refuses a traversal dressed up as a declared path', () => {
    expect(resolveClientConfigPath('claude-code', '~/.claude/settings.json/../../../../etc/passwd')).toBeNull()
    expect(resolveClientConfigPath('claude-code', '~/.claude/../.ssh/id_rsa')).toBeNull()
  })
})
