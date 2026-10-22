import { createPersistedStore } from './persisted-store'

/**
 * 测试参数。
 *
 * 它们只影响**服务端怎么写这一次诊断的请求**：轮次与提示词随每次入队一起走
 * (`ModelTestTaskItem`)。值本身记在本机（`localStorage`），所以关掉面板再打开还在——
 * 「这次怎么测」和「这台机器上习惯怎么测」是同一件事的两面。
 *
 * **并发不在这一份里。** 它现在是**服务端 kind 的属性**（诊断注册成串行，
 * 见 `packages/core/source/management/tasks/kinds/model-test.ts`）：同时在飞几个请求
 * 决定的是「上游读数是否被稀释」，那是服务端在调度时才知道的事，不该由界面逐次下发。
 * 界面能做的只是如实展示它——面板上不再有并发输入框。
 */
export interface TestConfig {
  inputLength: number
  rounds: number
  prompt: string
}

export const DEFAULT_TEST_CONFIG: TestConfig = {
  inputLength: 0,
  rounds: 1,
  prompt: '',
}

/*
 * 这两个参数**不设上限**。
 *
 * 有人想一次跑五十轮、想把提示词补到几十万字，那是他自己的账单和他的等待，界面不该
 * 替他判断「测到多少算够」。只保留下界（轮次至少一轮、长度不为负）——那不是策略，是定义。
 */

type PersistedModelTestConfigState = {
  config: TestConfig
}

interface ModelTestConfigState {
  config: TestConfig
  setConfig: (config: TestConfig) => void
  /** 恢复默认。用户主动按的，不是打开面板时偷偷清掉的。 */
  resetConfig: () => void
}

/**
 * 存档键名保留 `osw-model-test-config`：它是接口的一部分，改名等于把所有人的习惯清空。
 *
 * `config` 是**整份**替换的：`setConfig` 收到的是完整两项，所以这里不需要拆成两个键。
 */
export const useModelTestConfigStore = createPersistedStore<ModelTestConfigState, PersistedModelTestConfigState>({
  key: 'osw-model-test-config',
  // 诊断参数是这台机器上的习惯，不是这次会话的临时值。
  scope: 'machine',
  create: set => ({
    config: DEFAULT_TEST_CONFIG,
    setConfig: config => set({ config }),
    resetConfig: () => set({ config: DEFAULT_TEST_CONFIG }),
  }),
  pick: state => ({ config: state.config }),
  defaults: { config: DEFAULT_TEST_CONFIG },
}).store
