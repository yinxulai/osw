import type { StoreApi, StateCreator, UseBoundStore } from 'zustand'
import { createPersistedStore } from './persisted-store'

/**
 * 页面临时状态（草稿）的统一存放处。
 *
 * 控制台里有三类状态，寿命各不相同，混着放就会互相污染：
 *
 * | 哪一类 | 例子 | 落在哪 | 活多久 |
 * |---|---|---|---|
 * | 服务端事实 | 供应商、模型、设置 | 数据库 / 管理 API | 永久，跟着数据走 |
 * | 本机偏好 | 主题、语言、侧边栏、诊断参数 | `localStorage` | 永久，只在本机 |
 * | 页面临时状态 | 筛选条件、搜索词、看的是哪一条 | `sessionStorage` | 这个窗口 |
 *
 * 前两类与第三类走的是同一个工厂（`store/persisted-store.ts` 的 `createPersistedStore`），
 * 唯一区别是 `scope`：这里固定 `window`。这一层只额外做两件事——键名前缀，以及
 * 「一次清掉所有页面的草稿」。**没有第二套 `persist` 配置**，所以不会出现「这一页记的
 * 字段会回落、那一页不会」这种分歧。
 *
 * 用 `sessionStorage` 而不是 `localStorage`，因为「我刚才在看什么」的寿命正好是
 * **这个窗口**：重载（F5、自动更新后重进）还在，关掉窗口就该忘掉。存成永久偏好之后，
 * 用户几天后打开会看见一份自己早已忘记的筛选条件，并把「筛完什么都没有」当成
 * 「真的什么都没有」——那是最难自查的一类界面缺陷。
 */

/** 临时状态的键前缀。所有页面共用，看得出是谁写的。 */
const KEY_PREFIX = 'osw-scratch:'

/**
 * 某一页到底记哪几项。
 *
 * `pick` 与 `defaults` 是**分开**的两件事，理由见 `PersistedStoreSchema`：老存档里
 * 缺的字段要回落到默认值，不能是 `undefined`。
 */
export interface PageScratchSchema<State, Persisted extends object> {
  /**
   * 页面标识，进 storage key（`osw-scratch:<page>`）。
   *
   * 用页面路由名（`logs`、`request-logs`），不用中文、不用标题：它是键的一部分，
   * 改文案不该让所有人的草稿失效。
   */
  page: string
  /** 这一页的状态与动作。写法和普通 zustand store 一样。 */
  create: StateCreator<State>
  /** 从整份状态里挑出属于「我刚才在看什么」的那几项。动作与一次性弹窗开关不进存档。 */
  pick: (state: State) => Persisted
  /** 存档缺字段时的兜底。以后加字段只改这里，老存档照样能读。 */
  defaults: Persisted
}

export interface PageScratch<State> {
  store: UseBoundStore<StoreApi<State>>
  /**
   * 丢掉这一页记下的东西，整份回到初始状态。
   *
   * 「清空筛选」这类按钮与测试的 `beforeEach` 都用它：复位只该有一个定义处，
   * 各处手抄一份 `setState({ ... })` 迟早会漏掉后来加的那一项。
   */
  reset: () => void
}

/**
 * 已经加载过的页面临时状态，按页面标识登记。
 *
 * 登记只是为了让 {@link clearAllPageScratch} 也能把**内存里**的那份复位；存档本身
 * 是按 key 前缀扫的，所以没加载过的页面也照样清得掉。
 */
const resetters = new Map<string, () => void>()

/** 这一页在 `sessionStorage` 里的键名。 */
export function scratchStorageKey(page: string): string {
  return `${KEY_PREFIX}${page}`
}

/**
 * 清掉一页的临时状态：存档删掉，内存里那份也复位。
 *
 * 只动 `osw-scratch:` 开头的键，不碰 `localStorage` 里的偏好，也不碰别人的键。
 */
export function clearPageScratch(page: string): void {
  resetters.get(page)?.()
  try {
    window.sessionStorage.removeItem(scratchStorageKey(page))
  } catch {
    // 拿不到 storage 时本来就没存下东西，这里无事可做。
  }
}

/**
 * 清掉**所有**页面的临时状态。给「重开一个干净的界面」这类应用级动作。
 *
 * 一场会话里页面不会太多，先扫键名再删，比维护一份页面清单更不可能漏。
 */
export function clearAllPageScratch(): void {
  // 先复位内存：复位本身会往存档里写一份默认值，所以删键必须排在后面，否则
  // 「清干净」之后又会留下一堆写着默认值的键。
  resetters.forEach(reset => reset())
  try {
    const storage = window.sessionStorage
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null && key.startsWith(KEY_PREFIX)) keys.push(key)
    }
    keys.forEach(key => storage.removeItem(key))
  } catch {
    // 没有 storage 就没有要清的东西。
  }
}

/**
 * 注册一页的临时状态。
 *
 * ```ts
 * type PersistedLogsScratch = Pick<LogsUiState, 'levelFilter' | 'scopeFilter'>
 *
 * const scratch = createPageScratchStore<LogsUiState, PersistedLogsScratch>({
 *   page: 'logs',
 *   create: set => ({ … }),
 *   pick: state => ({ levelFilter: state.levelFilter, scopeFilter: state.scopeFilter }),
 *   defaults: { levelFilter: 'all', scopeFilter: 'proxy' },
 * })
 *
 * export const useLogsUiStore = scratch.store
 * export const resetLogsScratch = scratch.reset
 * ```
 *
 * 合并规则、storage 探测、复位都在 `createPersistedStore` 里，这里不加任何一条自己的
 * 规则：一页的草稿和主题偏好如果各有一套回落逻辑，迟早会出现「改了一项、另一项被
 * 悄悄清成默认」这种事。
 */
export function createPageScratchStore<State, Persisted extends object>(
  schema: PageScratchSchema<State, Persisted>,
): PageScratch<State> {
  const { store, reset } = createPersistedStore<State, Persisted>({
    key: scratchStorageKey(schema.page),
    scope: 'window',
    create: schema.create,
    pick: schema.pick,
    defaults: schema.defaults,
  })

  resetters.set(schema.page, reset)

  return { store, reset }
}
