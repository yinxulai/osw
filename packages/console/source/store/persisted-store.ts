import { create, type StoreApi, type StateCreator, type UseBoundStore } from 'zustand'
import { createJSONStorage, persist, type PersistStorage } from 'zustand/middleware'

/**
 * 一份状态该活多久。
 *
 * 控制台里所有「该记住的东西」只有两档寿命，判断标准是一句话：
 * **关掉窗口之后它该不该还在？**
 *
 * - `machine`：这台机器上这个人的**偏好**——主题、语言、侧边栏是否钉住、诊断参数。
 *   关掉应用再打开还在，换一台机器重新来一遍是对的。落 `localStorage`。
 * - `window`：这个窗口里**刚看过什么**——页面筛选、页码、展开的是哪一条。
 *   重载（F5、自动更新后重进）还在，关掉窗口就该忘掉。落 `sessionStorage`。
 *
 * 做成枚举而不是让各个 store 自己挑 `localStorage` / `sessionStorage`：
 * 「存在哪块区域」和「关掉窗口该不该还在」本来就是同一个判断，分开写迟早会写出两套
 * 互相矛盾的结论——那时没人能一眼看出某个键为什么活得比较久。
 */
export type PersistScope = 'machine' | 'window'

/**
 * 一份持久化状态记什么。
 *
 * `pick` 与 `defaults` 是**分开**的两件事，不是 `partialize` 一项就够：
 * 加字段之后，老存档里没有那一项，读出来会是 `undefined`——那不是「用户没填过」，
 * 而是「这一项那时还不存在」，必须回落到默认值。
 */
export interface PersistedStoreSchema<State, Persisted extends object> {
  /**
   * 在宿主 storage 里的键名。
   *
   * 键名会被截图脚本、旧版本存档用到，所以它是**接口**的一部分：改名等于让所有人的
   * 记录失效，只在真的想清空时改。
   */
  key: string
  /** 关掉窗口之后还要不要。见 {@link PersistScope}。 */
  scope: PersistScope
  /** 这份状态与动作。写法和普通 zustand store 一样。 */
  create: StateCreator<State>
  /** 从整份状态里挑出该记的那几项。动作与一次性弹窗开关不进存档。 */
  pick: (state: State) => Persisted
  /** 存档缺字段时的兜底。以后加字段只改这里，老存档照样能读。 */
  defaults: Persisted
}

export interface PersistedStore<State> {
  store: UseBoundStore<StoreApi<State>>
  /**
   * 丢掉记下的东西，整份回到初始状态。
   *
   * 「清空筛选」「恢复默认」这类按钮与测试的 `beforeEach` 都用它：复位只该有一个
   * 定义处，各处手抄一份 `setState({ ... })` 迟早会漏掉后来加的那一项。
   */
  reset: () => void
}

/** `machine` 走 `localStorage`，`window` 走 `sessionStorage`。 */
function resolveStorageArea(scope: PersistScope): Storage | undefined {
  return scope === 'window' ? window.sessionStorage : window.localStorage
}

/**
 * 从宿主拿一块 Storage，拿不到就返回 `undefined`。
 *
 * 两块区域都不保证可用：jsdom 里可以不提供，隐私模式下读属性就可能抛错，非浏览器宿主
 * 压根没有。Zustand 的默认 storage 是**急切**创建的，不可用要到第一次写入才炸；
 * 这里提前返回 `undefined`，让 `persist` 退回内存，界面照常能用，只是不记事。
 */
function createPersistStorage<Persisted>(scope: PersistScope): PersistStorage<Persisted> | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    const storage = resolveStorageArea(scope)
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
    ) {
      return undefined
    }
    return createJSONStorage<Persisted>(() => storage)
  } catch {
    return undefined
  }
}

/** 是不是一个可以逐键合并的普通对象（数组、`null`、日期都不算）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把存档叠在默认值上。
 *
 * 规则只有一条：**默认值有的键才认，缺的、`undefined` 的一律用默认值。**
 *
 * 默认值是对象时再往里合一层，这样以后多一个下拉、多一个参数字段时，老存档里那几项
 * 不会变成 `undefined`（会被当成「筛选值为 undefined」，既筛不掉也显示不对）。
 * 反过来，默认值是对象而存档里那一项不是对象（手改过、或上一版存的是别的形状），
 * 就整份按默认走——一个字符串顶替一整组参数，界面上每一格都会读不出来。
 */
function mergePersisted<Persisted extends object>(defaults: Persisted, persisted: unknown): Persisted {
  if (!isPlainObject(persisted)) return defaults
  const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) }
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const saved = persisted[key]
    if (saved === undefined) continue
    if (!isPlainObject(defaultValue)) {
      merged[key] = saved
      continue
    }
    if (isPlainObject(saved)) merged[key] = mergePersisted(defaultValue, saved)
  }
  return merged as Persisted
}

/**
 * 建一份会被记住的 store。
 *
 * ```ts
 * const appUi = createPersistedStore<AppUiState, PersistedAppUiState>({
 *   key: 'osw-ui',
 *   scope: 'machine',
 *   create: set => ({ … }),
 *   pick: state => ({ themeMode: state.themeMode }),
 *   defaults: { themeMode: 'system' },
 * })
 *
 * export const useAppUiStore = appUi.store
 * ```
 *
 * 这个函数是控制台里**唯一**一处写 `persist` 配置的地方。它替各个 store 承担四件事：
 * 挑哪块 storage（拿不到就退回内存）、旧存档缺字段时回落、存档形状对不上时的取舍、
 * 以及一份可以放心调用的复位。各个 store 只声明「记哪几项」「默认是什么」，不再各自
 * 拼 `merge` / `partialize`——那种写法在几个文件里就是几套略有出入的合并规则，
 * 而它们的 bug 都只在升级那一刻出现。
 */
export function createPersistedStore<State, Persisted extends object>(
  schema: PersistedStoreSchema<State, Persisted>,
): PersistedStore<State> {
  const store = create<State>()(persist(schema.create, {
    name: schema.key,
    storage: createPersistStorage<Persisted>(schema.scope),
    partialize: schema.pick,
    merge: (persisted, current) => ({ ...current, ...mergePersisted(schema.defaults, persisted) }),
  }))

  // `getInitialState()` 是 `persist` 注入的那份**未经水合**的初值，正好就是「默认」。
  const initialState = store.getInitialState()
  const reset = () => store.setState(initialState)

  return { store, reset }
}
