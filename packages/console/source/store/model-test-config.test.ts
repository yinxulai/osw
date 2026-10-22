// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEST_CONFIG, useModelTestConfigStore } from './model-test-config'

/*
 * 诊断的三个测试参数（轮次 / 输入长度 / 提示词）记在本机。
 *
 * 它们既不是服务端配置，也不是「这一次」的临时值：关掉面板再打开，上一回填的轮次
 * 应该还在——每次诊断都要从 1 轮重新填一遍没有意义。但换一台机器不该带走，
 * 所以落点是 `localStorage` 而不是服务端设置（见 `apps/docs/specs/diagnostics.md` §5）。
 *
 * **并发不在这一份里**：它现在由服务端 kind（`tasks/kinds/model-test.ts`）声明，
 * 测量的是「同时打几个上游」，属于调度而不是这台机器的偏好。
 */

const STORAGE_KEY = 'osw-model-test-config'

beforeEach(() => {
  window.localStorage.clear()
  useModelTestConfigStore.setState({ config: DEFAULT_TEST_CONFIG })
})

describe('默认值', () => {
  it('没填过时按最朴素的方式测一次', () => {
    const { config } = useModelTestConfigStore.getState()
    expect(config).toEqual({ rounds: 1, inputLength: 0, prompt: '' })
  })

  it('默认值里没有并发——并发不是界面参数', () => {
    expect(Object.keys(DEFAULT_TEST_CONFIG).sort()).toEqual(['inputLength', 'prompt', 'rounds'])
  })
})

describe('setter', () => {
  it('改一项不会顺手改动另外两项', () => {
    useModelTestConfigStore.getState().setConfig({ ...DEFAULT_TEST_CONFIG, rounds: 12 })
    const { config } = useModelTestConfigStore.getState()
    expect(config.rounds).toBe(12)
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
  it('三项都写进 localStorage，键名是 osw-model-test-config', () => {
    useModelTestConfigStore.getState().setConfig({
      rounds: 3,
      inputLength: 2000,
      prompt: '数到一千',
    })

    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toEqual({
      state: {
        config: { rounds: 3, inputLength: 2000, prompt: '数到一千' },
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
      state: { config: { rounds: 7, inputLength: 300, prompt: 'hello' } },
      version: 0,
    }))
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual({
      rounds: 7,
      inputLength: 300,
      prompt: 'hello',
    })
  })

  it('旧存档缺字段时，缺的那几项回落到默认值而不是 undefined', async () => {
    // 上一版只存了轮次。剩下两项不是「用户填了空」，是「那时还没有这一项」。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { config: { rounds: 5 } },
      version: 0,
    }))
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual({
      rounds: 5,
      inputLength: 0,
      prompt: '',
    })
  })

  it('存档里残留的并发不参与渲染也不参与校验（那一项已经搬去服务端）', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { config: { concurrency: 8, rounds: 2, inputLength: 0, prompt: '' } },
      version: 0,
    }))
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    // 读回来的三项仍然是这一版的三项，多余的那一键不改变任何一边的行为。
    expect(fresh.getState().config.rounds).toBe(2)
    expect(fresh.getState().config.inputLength).toBe(0)
  })

  it('存档坏掉时不让整个应用崩：整份回落到默认值', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')
    vi.resetModules()

    const { useModelTestConfigStore: fresh } = await import('./model-test-config')

    expect(fresh.getState().config).toEqual(DEFAULT_TEST_CONFIG)
  })
})
