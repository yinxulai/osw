/**
 * 地址栏里的语言与主题：读、写两侧的公共约定。
 *
 * 两项都放在查询串里（`?lang=zh-CN&theme=dark`），而不是一项当路径段、一项当查询参数。
 * 理由是这两件事在语义上本来就是同一类东西 —— 都是「用来看这一屏的视图参数」，
 * 却在下游处处分叉：一个参加路由匹配、一个不参加；一个缺失会让整段路径作废、一个缺失只是没值；
 * 一个要 `beforeLoad` 校验、一个只要 `validateSearch`。放进同一处之后，
 * 路由表退回成一张纯粹的「页面路径表」，拼接、匹配、保活都只有一套规则。
 *
 * 读出来的就是**生效值**：地址栏是一个正常的输入源，`?lang=zh-CN&theme=dark` 会被如实采纳。
 * 没写的那一项由持久化偏好兜底，偏好是 `system` 时再落到系统。
 * 由偏好补齐地址栏的那一半在 `@/hooks/use-appearance`。
 *
 * 「读」放在这一层、而不是挂在路由上，因为 `I18nProvider` 位于 `RouterProvider` **之上**
 * （根路由报错兜底也要取词）：在那一层 `useParams()` 之类根本取不到，只能直接读 history。
 */

import { useSyncExternalStore } from 'react'
import { normalizeLocale, type Locale } from '@common/i18n'
import { getHistory } from './history'

/**
 * 地址栏里主题参数的合法取值。
 *
 * `system` 也是合法值，和其他两个一样会被写进地址栏：它表达的是「跟随系统」这个**选择**，
 * 而不是「没有选择」。这样设置页的下拉框才能如实回显「跟随系统」，
 * 而具体是亮是暗交给系统实时决定。
 */
export type ThemeParam = 'light' | 'dark' | 'system'

/** 判断一个未知值是不是合法的主题参数，供路由的 `validateSearch` 与解析共用。 */
export function isThemeParam(value: unknown): value is ThemeParam {
  return value === 'light' || value === 'dark' || value === 'system'
}

export const LANG_PARAM = 'lang'
export const THEME_PARAM = 'theme'

export interface UrlOverrides {
  /** 查询串里的语言；缺失或不是受支持的语言时为 `null`（此时沿用持久化偏好）。 */
  lang: Locale | null
  /** `?theme=`；缺失或非法时为 `null`。 */
  theme: ThemeParam | null
}

/**
 * 把 `#/router?lang=zh-CN&theme=dark` 这类 href 解析出语言与主题。
 *
 * 不复用路由的解析器：这里的输入是 history 的原样地址（router 完成匹配之前就要能读），
 * 而需求只是「查询串里有没有合法的 lang 与 theme」。
 */
export function parseOverrides(href: string): UrlOverrides {
  const withoutHash = href.startsWith('#') ? href.slice(1) : href
  const queryIndex = withoutHash.indexOf('?')
  const search = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1)
  const params = new URLSearchParams(search)

  // 用 `normalizeLocale` 而不是 `isLocale`：`?lang=zh`、`?lang=zh-TW`、`?lang=zh-Hans-CN`
  // 都是同一个「中文」意图，不该因为写法不标准就被当成不认识的语言而落到英文。
  const theme = params.get(THEME_PARAM)

  return { lang: normalizeLocale(params.get(LANG_PARAM)), theme: isThemeParam(theme) ? theme : null }
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

/** 订阅地址栏里的语言与主题。 */
export function useUrlOverrides(): UrlOverrides {
  const href = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (href !== cachedHref) {
    cachedHref = href
    cachedOverrides = parseOverrides(href)
  }
  return cachedOverrides
}

/** `appearanceSearch` 的补值：`null` = 这一项不动，否则「没有就补上」。 */
interface AppearanceFill {
  lang: Locale | null
  theme: ThemeParam | null
}

/**
 * 往地址栏补语言与主题的统一写法：**只补缺的，已有的一律不动**。
 *
 * 两条容易踩的规则都收在这里，调用方不用各自记：
 * - `search` 是**整体替换**语义，所以只能传函数（`prev => ...`）把同层其余的键带出来；
 * - 不需要写的那一项留 `undefined`，这样序列化时不会留下 `?lang=` 这种空值。
 */
export function appearanceSearch(current: Record<string, unknown>, next: AppearanceFill): Record<string, unknown> {
  const merged = { ...current }
  if (next.lang && !merged[LANG_PARAM]) merged[LANG_PARAM] = next.lang
  if (next.theme && !merged[THEME_PARAM]) merged[THEME_PARAM] = next.theme
  return merged
}
