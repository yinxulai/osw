// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEST_CONFIG, TEST_CONCURRENCY, useModelTestConfigStore } from './model-test-config'

/*
 * 诊断的四个测试参数（并发 / 轮次 / 输入长度 / 提示词）记在本机。
 *
 * 它们既不是服务端配置，也不是「这一次」的临时值：关掉面板再打开，上一回填的轮次
 * 应该还在——每次诊断都要从 1 轮重新填一遍没有意义。但换一台机器不该带走，
 * 所以落点是 `localStorage` 而不是服务端设置（见 `apps/docs/specs/operations/diagnostics.md` §5）。
 */

const STORAGE_KEY = 'osw-model-test-config'

beforeEach(() => {
  window.localStorage.clear()
  useModelTestConfigStore.setState({ config: DEFAULT_TEST_CONFIG })
})

describe('默认值', () => {
  it('没填过时按最朴素的方式测一次', () => {
    const { config } = useModelTestConfigStore.getState()
    expect(config).toEqual({ concurrency: TEST_CONCURRENCY, rounds: 1, inputLength: 0, prompt: '' })
  })
})

describe('setter', () => {
  it('改一项不会顺手改动另外三项', () => {
    useModelTestConfigStore.getState().setConfig({ ...DEFAULT_TEST_CONFIG, rounds: 12 })
    const { config } = useModelTestConfigStore.getState()
    expect(config.rounds).toBe(12)
    expect(config.concurrency).toBe(TEST_CONCURRENCY)
    expect(config.inputLength).toBe(0)
    expect(config.prompt).toBe('')
  })

  it('「恢复默认」只由用户主动按，不会被别处偷偷触发', () => {
    useModelTestConfigStore.getState().setConfig({ ...DEFAULT_TEST_CONFIG, rounds: 5, prompt: '数到一百' })
    useModelTestConfigStore.getState().resetConfig()
    expect(useModelTestConfigStore.getState().config).toEqual(DEFAULT_TEST_CONFIG)
  })
})

describe('持久化', () => {
  it('四项都写进 localStorage，键名是 osw-model-test-config', () => {
    useModelTestConfigStore.getState().setConfig({
      concurrency: 8,
      rounds: 3,
      inputLength: 2000,
      prompt: '数到一千',
    })

    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toEqual({
      state: {
        config: { concurrency: 8, rounds: 3, inputLength: 2000, prompt: '数到一千' },
      },
      version: 0,
    })
  })

  it('只存 config，setter 不会被序列化进去', () => {
    useModelTestConfigStore.getState().setConfig({ ...DEFAULT_TEST_CONFIG, rounds: 2 })
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) as string).state
    expect(Object.keys(persisted)).toEqual(['config'])
  })

  it('重新建一份实例时会读回上次写入的值（关掉面板再打开）', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { config: { concurrency: 4, rounds: 7, inputLength: 300, prompt: 'hello' } },
      version: 0,
    }))
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual({
      concurrency: 4,
      rounds: 7,
      inputLength: 300,
      prompt: 'hello',
    })
  })

  it('旧存档缺字段时，缺的那几项回落到默认值而不是 undefined', async () => {
    // 上一版只存了轮次。剩下三项不是「用户填了空」，是「那时还没有这一项」。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { config: { rounds: 5 } },
      version: 0,
    }))
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual({
      concurrency: TEST_CONCURRENCY,
      rounds: 5,
      inputLength: 0,
      prompt: '',
    })
  })

  it('存档坏掉时不让整个应用崩：整份回落到默认值', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual(DEFAULT_TEST_CONFIG)
  })
})
