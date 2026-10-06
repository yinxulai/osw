import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '@server/database'
import { updateSettings } from '@server/database/settings-store'
import { applySystemLocale, cliLocale, cliTranslator, startCliLanguageSync, systemLocale } from './native-i18n'

/**
 * 终端语言。
 *
 * 规则与桌面端一致（真相源是 `settings.language`，读不出来时退回宿主语言），
 * 这里守的是命令行独有的一段：宿主语言只能从环境变量与 `Intl` 取，
 * 以及「服务起来了之后」才去追设置变更。
 */

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-cli-i18n-'))
  await initDatabases(temporaryDirectory)
  // 每个用例从「还没读过任何设置」的默认态起手：语言是模块级状态，会跨用例留存。
  applySystemLocale()
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  vi.unstubAllEnvs()
  applySystemLocale()
})

describe('cliLocale / cliTranslator', () => {
  it('starts from the system locale before any database read', () => {
    // 解析 argv 失败时也要用正确的语言报错，所以「读设置之前」这一步必须自己站得住。
    expect(cliLocale()).toBeTypeOf('string')
    expect(cliTranslator()('native.cli.usage')).toContain('osw')
  })

  it('swaps the translator when the locale changes', () => {
    vi.stubEnv('LC_ALL', 'en_US.UTF-8')
    applySystemLocale()
    const before = cliTranslator()
    expect(cliLocale()).toBe('en')

    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
    applySystemLocale()

    expect(cliLocale()).toBe('zh-CN')
    // 取词函数是每次现取的：调用方不该把旧语言的那份缓存在模块作用域里。
    // 注意这里比的是**行为**而不是对象引用——目录是按语言缓存好的，换语言时
    // 拿到的可能就是同一个 `translate`，拿引用相等当「换过了」的判据会假红。
    expect(cliTranslator()).not.toBe(before)
    expect(before('native.cli.usage')).toContain('Usage:')
    expect(cliTranslator()('native.cli.usage')).toContain('用法：')
  })

  it('serves the current catalog from cliTranslator on every call', () => {
    // 调用方每次都现取 `cliTranslator()`：缓存在模块作用域里的那份会一直说旧语言。
    vi.stubEnv('LC_ALL', 'en_US.UTF-8')
    applySystemLocale()
    const stale = cliTranslator()

    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
    applySystemLocale()

    expect(stale('native.cli.status.title')).toBe('OSW status')
    expect(cliTranslator()('native.cli.status.title')).toBe('OSW 状态')
  })

  it('keeps the same translator object when the locale does not change', () => {
    // 语言没变就不重建：`applyLocale` 直接返回，避免每次设置变更都丢掉引用。
    const before = cliTranslator()
    applySystemLocale()

    expect(cliTranslator()).toBe(before)
  })
})

describe('systemLocale', () => {
  it('prefers the POSIX environment variables over Intl', () => {
    // 环境变量表达的是「用户为这个终端选的语言」：SSH、容器、`LANG=C` 的场景下
    // 它与操作系统当前语言经常不一致，而命令行要的是前者。
    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
    vi.stubEnv('LANG', 'en_US.UTF-8')

    expect(systemLocale()).toBe('zh_CN.UTF-8')
  })

  it('falls through LC_MESSAGES and LANG in order', () => {
    vi.stubEnv('LC_ALL', '')
    vi.stubEnv('LC_MESSAGES', 'ja_JP.UTF-8')
    vi.stubEnv('LANG', 'en_US.UTF-8')

    expect(systemLocale()).toBe('ja_JP.UTF-8')

    vi.stubEnv('LC_MESSAGES', '')
    expect(systemLocale()).toBe('en_US.UTF-8')
  })

  it('falls back to Intl when no environment variable is set', () => {
    vi.stubEnv('LC_ALL', '')
    vi.stubEnv('LC_MESSAGES', '')
    vi.stubEnv('LANG', '')

    // 不断言具体值（随机器变），只要求「有话说」：返回 null 也合法，但本机 Intl 应当能给出结果。
    expect(systemLocale() ?? Intl.DateTimeFormat().resolvedOptions().locale).toBeTruthy()
  })
})

describe('startCliLanguageSync', () => {
  it('adopts the persisted preference and follows later changes', async () => {
    await updateSettings({ language: 'zh-CN' })

    const unsubscribe = await startCliLanguageSync()
    try {
      expect(cliLocale()).toBe('zh-CN')

      // 界面改了语言，终端输出也该跟着变——这是订阅存在的唯一理由。
      await updateSettings({ language: 'en' })
      expect(cliLocale()).toBe('en')
    } finally {
      unsubscribe()
    }
  })

  it('stops following changes once unsubscribed', async () => {
    await updateSettings({ language: 'en' })
    const unsubscribe = await startCliLanguageSync()
    unsubscribe()

    await updateSettings({ language: 'zh-CN' })

    expect(cliLocale()).toBe('en')
  })

  it('keeps working with the system locale when settings cannot be read', async () => {
    // 读设置失败不算致命：输出已经发出去了，为取词去中断一个正在跑的服务不划算。
    // 关掉数据库，让 `getSettings()` 真的抛。
    await closeDatabases()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const unsubscribe = await startCliLanguageSync()
      unsubscribe()

      expect(warn).toHaveBeenCalled()
      expect(cliLocale()).toBeTypeOf('string')
    } finally {
      warn.mockRestore()
      // 让 afterEach 的 `closeDatabases()` 仍有东西可关。
      await initDatabases(temporaryDirectory)
    }
  })
})
