// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clampConfigNumber } from '../lib/model-test/config'
import { DEFAULT_TEST_CONFIG, TEST_CONCURRENCY, useModelTestConfigStore } from './model-test-config'

/*
 * 诊断的四个测试参数（并发 / 轮次 / 输入长度 / 提示词）记在本机。
 *
 * 它们既不是服务端配置，也不是「这一次」的临时值：关掉面板再打开，上一回填的轮次
 * 应该还在——每次诊断都要从 1 轮重新填一遍没有意义。但换一台机器不该带走，
 * 所以落点是 `localStorage` 而不是服务端设置（见 `apps/docs/specs/operations/diagnostics.md` §5）。
 *
 * **并发也在这一份里**：它是「这次入队的调度上限」（`TaskEnqueueRequestSchema.concurrency`），
 * 覆盖 kind 声明的那条串行默认，但仍然只是这台机器上的习惯——服务端不读它，也没有
 * 「服务端配置的并发」这种东西。
 */

const STORAGE_KEY = 'osw-model-test-config'

beforeEach(() => {
  window.localStorage.clear()
  useModelTestConfigStore.setState({ config: DEFAULT_TEST_CONFIG })
})

describe('默认值', () => {
  it('没填过时按最朴素的方式测一次', () => {
    const { config } = useModelTestConfigStore.getState()
    expect(config).toEqual({ concurrency: 3, rounds: 1, inputLength: 0, prompt: '' })
  })

  it('默认并发是 3：它是起点不是上限', () => {
    expect(TEST_CONCURRENCY).toBe(3)
    expect(DEFAULT_TEST_CONFIG.concurrency).toBe(TEST_CONCURRENCY)
    expect(Object.keys(DEFAULT_TEST_CONFIG).sort()).toEqual(['concurrency', 'inputLength', 'prompt', 'rounds'])
  })

  /**
   * 并发这一项的合法化：**只有下界 1，没有上界**。
   *
   * 输入框允许空、负数、小数、`e` 记法。规则与轮次 / 输入长度共用同一个
   * `clampConfigNumber`（那一行传的 `min` 是 1），所以「空输入落回 1」不是并发特有的
   * 行为，而是这一族数字项共同的规则。
   */
  it('并发写 0 / 负数 / 小数 / NaN 都落到下界 1，写多大就是多大', () => {
    expect(clampConfigNumber(0, 1)).toBe(1)
    expect(clampConfigNumber(-5, 1)).toBe(1)
    expect(clampConfigNumber(Number.NaN, 1)).toBe(1)
    expect(clampConfigNumber(4.9, 1)).toBe(4)
    expect(clampConfigNumber(500, 1)).toBe(500)
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
      state: { config: { concurrency: 6, rounds: 7, inputLength: 300, prompt: 'hello' } },
      version: 0,
    }))
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual({
      concurrency: 6,
      rounds: 7,
      inputLength: 300,
      prompt: 'hello',
    })
  })

  it('旧存档缺字段时，缺的那几项回落到默认值而不是 undefined', async () => {
    // 上一版只存了轮次。剩下三项不是「用户填了空」，是「那时还没有这一项」——
    // 并发是这一版才回来的，所以老存档读出来必须是默认的 3，而不是 undefined。
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
