/**
 * 地址栏里的临时覆盖：`lang`（路径段）与 `theme`（搜索参数）。
 *
 * 这一层刻意**不持久化**：`/zh-CN/router?theme=dark` 表达的是「这条链接按这个语言、
 * 这个主题打开」，是一次性的观察视角，不是「我以后都要这样」。写进地址栏的价值恰恰在于
 * 它**不落盘** —— 可以随手贴给别人、可以在同一台机器上并列对比两种语言，而不会污染
 * 使用者真正保存下来的偏好。
 *
 * 于是优先级是：**URL > 持久化偏好 > 系统**。URL 有值就照它渲染，没有就落回
 * `useLanguageStore` / 服务端 `settings.language` / `useAppUiStore.themeMode` 那一套。
 *
 * 覆盖值**不写回偏好**：`?theme=dark` 只影响这一次渲染，用户以后打开还是他自己选的主题。
 * 想「记住」，就去设置页改偏好 —— 那是另一条路，两者刻意不互相污染。
 *
 * 「读」放在这一层、而不是挂在路由上，因为 `I18nProvider` 位于 `RouterProvider` **之上**
 * （根路由报错兜底也要取词）：在那一层 `useParams()` 之类根本取不到，只能直接读 history。
 * 「写」则相反，统一走路由跳转，好让地址栏、`Link`、前进后退保持同一套事实。
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { normalizeLocale, type Locale } from '@common/i18n'
import { getHistory } from './history'

/** 主题覆盖只认这两个具体值：`system` 是「没有覆盖」，而不是一个可覆盖的选项。 */
export type ThemeOverride = 'light' | 'dark'

export interface UrlOverrides {
  /** 路径里的语言段；缺失或不是受支持的语言时为 `null`（此时沿用持久化偏好）。 */
  lang: Locale | null
  /** `?theme=`；缺失或非法时为 `null`。 */
  theme: ThemeOverride | null
}

const THEME_PARAM = 'theme'

/**
 * 把 `#/zh-CN/router?theme=dark` 这类 href 解析成覆盖值。
 *
 * 不复用路由的解析器：这里的输入是 history 的原样地址（router 完成匹配之前就要能读），
 * 而需求只是「第一个路径段是不是受支持的语言」「查询串里有没有合法的 theme」。
 */
export function parseOverrides(href: string): UrlOverrides {
  const withoutHash = href.startsWith('#') ? href.slice(1) : href
  const queryIndex = withoutHash.indexOf('?')
  const pathname = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex)
  const search = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1)

  // 只认第一个段：`/zh-CN` 是覆盖，`/overview/zh-CN` 里的 `zh-CN` 只是普通路径参数。
  // 用 `normalizeLocale` 而不是 `isLocale`：`/zh`、`/zh-TW`、`/zh-Hans-CN` 都是同一个「中文」意图，
  // 不该因为写法不标准就被当成不认识的语言而落到英文。
  const lang = normalizeLocale(pathname.split('/').filter(Boolean)[0])
  const theme = new URLSearchParams(search).get(THEME_PARAM)

  return {
    lang,
    theme: theme === 'light' || theme === 'dark' ? theme : null,
  }
}

/**
 * 缓存一份解析结果。
 *
 * 快照取的是 href **字符串**而不是解析后的对象：`useSyncExternalStore` 每次渲染都会调
 * `getSnapshot`，返回新对象会让它判定「值一直在变」而反复重渲染。所以对外只暴露字符串快照，
 * 解析结果按 href 缓存，href 真变了才重算。
 */
let cachedHref: string | null = null
let cachedOverrides: UrlOverrides = { lang: null, theme: null }

function subscribe(onStoreChange: () => void): () => void {
  return getHistory().subscribe(() => onStoreChange())
}

function snapshot(): string {
  return getHistory().location.href
}

/** 订阅地址栏里的覆盖值。 */
export function useUrlOverrides(): UrlOverrides {
  const href = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (href !== cachedHref) {
    cachedHref = href
    cachedOverrides = parseOverrides(href)
  }
  return cachedOverrides
}

/**
 * 语言段在 `params` 里怎么写。
 *
 * 这里藏着最容易踩的一条：`navigate`/`Link` 的 `params` 里**省略某个 key 等于继承当前值**，
 * 只有显式给 `undefined` 才表示「不要这一段」。所以「跳到某页但不带语言」必须写成
 * `params: { lang: undefined }` —— 写成 `params: {}` 会原样继承 `zh-CN`。
 */
export interface LangParams {
  lang?: Locale
}

export function langParams(lang: Locale | null): LangParams {
  return { lang: lang ?? undefined }
}

/**
 * 覆盖值的清除端。
 *
 * 谁负责清、谁负责写，是这套机制里最容易做错的地方，所以定死一条规则：
 * **界面上切换语言/主题 = 写持久化偏好，同时清掉同维度的临时覆盖**；
 * **手改 URL = 只改这一次的视角，永远不写偏好**。
 *
 * 为什么切换偏好时必须顺手清掉覆盖：否则「你刚设的那个」会立刻被地址栏里的旧覆盖盖住 ——
 * 用户明明点了「English」，界面却还是中文，看起来就是坏的。
 *
 * 清除统一走相对跳转 `to: '.'`：当前页可能是带参数的详情页，也可能是索引子路由，
 * 让路由自己解析才能原地保留页面、参数与其余搜索参数（`range`、`q`）。
 */
export interface UrlOverrideActions {
  /** 清掉路径里的语言段，让界面回到持久化偏好。没有语言段时不跳转。 */
  clearLang: () => void
  /** 清掉 `?theme=`，让界面回到持久化偏好。没有 `?theme=` 时不跳转。 */
  clearTheme: () => void
}

export function useUrlOverrideActions(): UrlOverrideActions {
  const navigate = useNavigate()
  const { lang, theme } = useUrlOverrides()

  const clearLang = useCallback(() => {
    // `params.lang: undefined` 才是「去掉这一段」；省略这个 key 会继承当前值（见 `langParams`）。
    if (lang) void navigate({ to: '.', params: { lang: undefined }, replace: true })
  }, [lang, navigate])

  const clearTheme = useCallback(() => {
    if (theme) void navigate({ to: '.', search: prev => ({ ...prev, theme: undefined }), replace: true })
  }, [theme, navigate])

  return { clearLang, clearTheme }
}
