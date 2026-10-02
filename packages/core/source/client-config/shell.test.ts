import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { envFileHeader, hasManagedBlock, managedBlock, resolveShellProfilePath, shellProfileCandidates, stripEnvFileHeader, upsertManagedBlock } from './shell'

/**
 * 这里测的是「往用户启动文件里塞一段哨兵区段」的那套纯逻辑。
 *
 * 危险的地方不在写对值，而在**把用户的启动文件写坏**：多写一段、漏掉一段、把别人的行吃掉，
 * 都会让用户下次开终端时莫名多一行报错。所以核心断言都围绕「恰好一段、其余不动」——
 * 全部是结构式断言（数哨兵出现次数、比对前后行集合），不用 `not.toContain` 去猜。
 */

const POSIX = 'posix' as const
const WINDOWS = 'windows' as const
const ENV_PATH = '/Users/me/.copilot/osw.env'

const countOf = (text: string, needle: string): number => text.split(needle).length - 1

describe('managedBlock', () => {
  it('POSIX 区段用点命令加载 env 文件，并用同一对哨兵包起来', () => {
    const block = managedBlock(POSIX, ENV_PATH)
    expect(block).toContain('. "/Users/me/.copilot/osw.env"')
    expect(block).toContain('[ -f "/Users/me/.copilot/osw.env" ]')
    const [first, , last] = block.split('\n')
    expect(first).toContain('>>> osw managed env >>>')
    expect(last).toContain('<<< osw managed env <<<')
  })

  it('Windows 区段用 PowerShell 点源，并在文件存在时才加载', () => {
    const block = managedBlock(WINDOWS, 'C:\\Users\\me\\.copilot\\osw.env')
    expect(block).toContain('Test-Path "C:\\Users\\me\\.copilot\\osw.env"')
    expect(block).toContain('. "C:\\Users\\me\\.copilot\\osw.env"')
    expect(hasManagedBlock(block)).toBe(true)
  })
})

describe('upsertManagedBlock', () => {
  it('启动文件为空时，只写下这一块，且以换行结尾', () => {
    const next = upsertManagedBlock('', managedBlock(POSIX, ENV_PATH))
    expect(next).toBe(`${managedBlock(POSIX, ENV_PATH)}\n`)
    expect(countOf(next, '>>> osw managed env >>>')).toBe(1)
  })

  it('启动文件已有别的内容时，保留原文并在其后追加这一块', () => {
    const original = 'export PATH="$HOME/bin:$PATH"\nalias ll="ls -l"'
    const next = upsertManagedBlock(original, managedBlock(POSIX, ENV_PATH))
    expect(next.startsWith(original)).toBe(true)
    expect(next).toContain('export PATH="$HOME/bin:$PATH"')
    expect(next).toContain('alias ll="ls -l"')
    expect(countOf(next, '>>> osw managed env >>>')).toBe(1)
  })

  it('原文以换行结尾时不会夹出多余空行', () => {
    const next = upsertManagedBlock('foo\n', managedBlock(POSIX, ENV_PATH))
    expect(next).toBe(`foo\n\n${managedBlock(POSIX, ENV_PATH)}\n`)
  })

  it('再次写入时整段替换，绝不产生第二块', () => {
    const once = upsertManagedBlock('alias ll="ls -l"\n', managedBlock(POSIX, ENV_PATH))
    const twice = upsertManagedBlock(once, managedBlock(POSIX, ENV_PATH))
    expect(twice).toBe(once)
    expect(countOf(twice, '>>> osw managed env >>>')).toBe(1)
    expect(countOf(twice, '<<< osw managed env <<<')).toBe(1)
  })

  it('env 文件路径换了以后，旧块被整段改写、块外内容一字不动', () => {
    const original = 'before\nalias ll="ls -l"\n'
    const once = upsertManagedBlock(original, managedBlock(POSIX, '/old/path.env'))
    const twice = upsertManagedBlock(once, managedBlock(POSIX, '/new/path.env'))
    expect(twice).toContain('. "/new/path.env"')
    expect(twice).toContain('before')
    expect(twice).toContain('alias ll="ls -l"')
    expect(countOf(twice, '>>> osw managed env >>>')).toBe(1)
  })

  it('块被夹在用户内容中间时，替换不会吃掉上下两边的行', () => {
    const original = ['# top', 'first() { echo 1; }', 'last() { echo 2; }'].join('\n')
    const withBlock = upsertManagedBlock(original, managedBlock(POSIX, ENV_PATH))
    const rewritten = upsertManagedBlock(withBlock, managedBlock(POSIX, '/moved/path.env'))
    expect(rewritten).toContain('first() { echo 1; }')
    expect(rewritten).toContain('last() { echo 2; }')
    expect(rewritten).toContain('. "/moved/path.env"')
    expect(countOf(rewritten, '>>> osw managed env >>>')).toBe(1)
  })

  it('只有半个哨兵（被手删了半截）时当作不存在，追加一整块', () => {
    const half = `alias ll="ls -l"\n${managedBlock(POSIX, ENV_PATH).split('\n')[0]}\n`
    const next = upsertManagedBlock(half, managedBlock(POSIX, ENV_PATH))
    expect(countOf(next, '<<< osw managed env <<<')).toBe(1)
    expect(next).toContain('alias ll="ls -l"')
  })
})

describe('hasManagedBlock', () => {
  it('完整的一块判定为真', () => {
    expect(hasManagedBlock(upsertManagedBlock('', managedBlock(POSIX, ENV_PATH)))).toBe(true)
  })

  it('普通启动脚本判定为假', () => {
    expect(hasManagedBlock('export PATH="$HOME/bin:$PATH"\n')).toBe(false)
  })

  it('只有起始哨兵不算数', () => {
    expect(hasManagedBlock('# >>> osw managed env >>>\n')).toBe(false)
  })
})

describe('shellProfileCandidates', () => {
  it('zsh 用户优先改 .zshrc', () => {
    const candidates = shellProfileCandidates(POSIX, '/Users/me', { SHELL: '/bin/zsh' })
    expect(candidates[0]).toBe('/Users/me/.zshrc')
    expect(candidates).toContain('/Users/me/.bash_profile')
  })

  it('$SHELL 指明 bash 时把 bash 启动文件排到前面', () => {
    const candidates = shellProfileCandidates(POSIX, '/Users/me', { SHELL: '/bin/bash' })
    expect(candidates[0]).toBe('/Users/me/.bash_profile')
    expect(candidates).toContain('/Users/me/.zshrc')
  })

  it('Windows 指向 PowerShell profile 的两处默认位置', () => {
    // 期望值也用 `join` 拼：模块内部就是 `join`，路径分隔符随平台走（Windows 上得到反斜杠）。
    const home = join('C:', 'Users', 'me')
    const candidates = shellProfileCandidates(WINDOWS, home, {})
    expect(candidates).toEqual([
      join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ])
  })
})

describe('resolveShellProfilePath', () => {
  const candidates = ['/Users/me/.zshrc', '/Users/me/.bash_profile', '/Users/me/.profile']

  it('存在多个候选时挑优先级最高的那个', () => {
    expect(resolveShellProfilePath(['/Users/me/.bash_profile', '/Users/me/.zshrc'], candidates)).toBe('/Users/me/.zshrc')
  })

  it('只有低优先级候选存在时改它', () => {
    expect(resolveShellProfilePath(['/Users/me/.profile'], candidates)).toBe('/Users/me/.profile')
  })

  it('一个都不存在时落到第一候选（新建）', () => {
    expect(resolveShellProfilePath([], candidates)).toBe('/Users/me/.zshrc')
  })
})

describe('envFileHeader', () => {
  it('整段都是 shell 注释，说明文件由 OSW 生成且不要手改', () => {
    // 每个非空行都必须以 `#` 开头，否则被 source 时 shell 会报错。
    const header = envFileHeader('en')
    const lines = header.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.filter(line => line.trim() !== '').every(line => line.startsWith('#'))).toBe(true)
    expect(header.startsWith('# Generated by One Switch')).toBe(true)
    expect(header).toContain('do not edit')
  })

  it('中文抬头同样整段是 shell 注释', () => {
    const header = envFileHeader('zh-CN')
    const lines = header.split('\n')
    expect(lines.filter(line => line.trim() !== '').every(line => line.startsWith('#'))).toBe(true)
    // 与英文抬头区分开，确认真的按语言取词而不是回退到英文。
    expect(header).not.toBe(envFileHeader('en'))
    expect(header.startsWith(createAppTranslator('zh-CN')('clientConfig.envFile.header.title'))).toBe(true)
  })
})

describe('stripEnvFileHeader', () => {
  it('剥掉当前语言的抬头，只留下正文', () => {
    const header = envFileHeader('en')
    expect(stripEnvFileHeader(`${header}\n\nFOO=bar\n`)).toBe('FOO=bar\n')
  })

  it('任意语言的抬头都能剥掉——换语言重写不会叠出两段抬头', () => {
    const zh = envFileHeader('zh-CN')
    expect(stripEnvFileHeader(`${zh}\nKEY=value`)).toBe('KEY=value')
  })

  it('没有抬头时原样返回', () => {
    expect(stripEnvFileHeader('FOO=bar\n')).toBe('FOO=bar\n')
  })

  it('只有抬头没有正文时返回空串', () => {
    expect(stripEnvFileHeader(envFileHeader('en'))).toBe('')
    expect(stripEnvFileHeader(`${envFileHeader('en')}\n`)).toBe('')
  })
})
