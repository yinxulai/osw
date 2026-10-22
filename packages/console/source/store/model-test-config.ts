import { createPersistedStore } from './persisted-store'

/**
 * 默认并发数。
 *
 * 它是**起点**不是上限：界面上调高调低都不受它约束，见下面那段「不设上限」。
 */
export const TEST_CONCURRENCY = 3

/**
 * 测试参数。
 *
 * 它们只影响**这一次诊断怎么写请求**，不进服务端配置：并发是界面侧的 worker 数，
 * 轮次与提示词是随每次 `/api/model-test/run` 走的值。
 *
 * 值本身记在本机（`localStorage`），所以关掉面板再打开还在——「这次怎么测」和
 * 「这台机器上习惯怎么测」是同一件事的两面，每次都从 1 轮重新填一遍没有意义。
 * 但它不是服务端事实，换台机器不会带走（见 `apps/docs/specs/operations/diagnostics.md` §5）。
 */
export interface TestConfig {
  concurrency: number
  inputLength: number
  rounds: number
  prompt: string
}

export const DEFAULT_TEST_CONFIG: TestConfig = {
  concurrency: TEST_CONCURRENCY,
  inputLength: 0,
  rounds: 1,
  prompt: '',
}

/*
 * 这三个参数**不设上限**。
 *
 * 它们约束的是「这一次怎么测」，不是服务端的容量：有人想一次跑五十轮、想把提示词
 * 补到几十万字，那是他自己的账单和他的等待，界面不该替他判断「测到多少算够」。
 * 只保留下界（轮次至少一轮、长度不为负）——那不是策略，是定义。
 *
 * 这条跟「记不记得住」无关：上界加了就是加了，存到哪里都还是替用户拍板。
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
 * `config` 是**整份**替换的：`setConfig` 收到的是完整四项，所以这里不需要把四个数字
 * 拆成四个键。「恢复默认」是用户主动按的，与存档层无关——所以它仍然是 store 自己的
 * 一个动作，而不是 {@link createPersistedStore} 返回的 `reset`（后者是给测试复位和
 * 「重开干净界面」用的）。
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
