/**
 * 语言与主题的唯一状态源，外加「让地址栏始终如实写下它」的那一半。
 *
 * 只保留**一份**状态（持久化偏好），地址栏随时跟着它走 —— 任何一条地址都自带完整的语言与主题，
 * 复制出去就能复现同一幅界面。反过来做（偏好与地址栏各存一份、再定谁盖过谁）必然漂移：
 * 两份状态只要有一边变化就会分叉，而「谁优先」那条规则本身就制造了分叉。
 *
 * 地址栏同时也**是一个输入源**：`?lang=zh-CN&theme=dark` 会被如实采纳（`useUrlOverrides` 读它），
 * 所以手改地址就能直接指定语言与主题。它只是不写回偏好 —— 偏好是「以后都这样」，
 * 地址栏是「这一屏怎么看」，两者都不该被对方改写。
 *
 * 于是写地址栏只有两处，各管一段、互不重叠：
 * - 缺参数时按偏好补上 —— `useAppearanceUrlSync`（覆盖首次进入与外部链接）；
 * - 界面切换时按新偏好改写 —— `useAppearance` 的 setter（覆盖「参数已存在但值旧了」）。
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { LanguagePreference } from '@common/i18n'
import { resolveLocale, type Locale } from '@common/i18n'
import { getSystemLocale, useLanguageStore } from '@/i18n/store'
import { useAppUiStore } from '@/store/app-ui-store'
import { appearanceSearch, useUrlOverrides } from '@/routing/url-overrides'
import type { Theme, ThemeMode } from '@/components/app-sidebar'

export interface ResolvedAppearance {
  /** 唯一状态源：持久化的语言偏好。 */
  language: LanguagePreference
  /** 唯一状态源：持久化的主题选择，含「跟随系统」。 */
  themeMode: ThemeMode
  /** 生效的主题模式（地址栏覆盖 > 偏好）。告知宿主「跟不跟系统」时必须用它：解析后的
   * `theme` 表达不了这件事——`dark` 可能是手选的，也可能是跟着系统来的。 */
  effectiveThemeMode: ThemeMode
  /** 推导出的生效值：地址栏 > 偏好 > 系统，只读。 */
  locale: Locale
  /** 屏幕上是亮是暗；「跟随系统」时由系统实时决定。 */
  theme: Theme
}

export interface Appearance extends ResolvedAppearance {
  /** 改语言偏好，并让地址栏跟上。 */
  setLanguage: (language: LanguagePreference) => void
  /** 改主题偏好，并让地址栏跟上。 */
  setThemeMode: (mode: ThemeMode) => void
  /** 主题开关：亮暗翻转，并把它落成偏好（不经过「跟随系统」）。 */
  toggleTheme: () => void
}

/**
 * 只读的那一半：偏好 + 地址栏覆盖 → 生效的语言与主题。
 *
 * 不需要改偏好、因而不需要路由的调用方走这里。托盘面板就是这样一个调用方：它用**内存
 * 路由**，没有可以跳转的地址栏（语言与主题的地址栏覆盖在窗口创建前就由启动脚本读进
 * `<html>` 了），但它要画的和主界面一模一样的亮暗与语言。
 *
 * 依赖 `useUrlOverrides`，那是 `history` 上的一个外部订阅，不在路由上下文里也能跑。
 */
export function useResolvedAppearance(): ResolvedAppearance {
  const { lang: urlLang, theme: urlTheme } = useUrlOverrides()

  const language = useLanguageStore(state => state.preference)
  const themeMode = useAppUiStore(state => state.themeMode)

  // 地址栏里的值就是生效值；它没有时落回偏好，偏好是「跟随系统」时再落到系统语言。
  const locale = urlLang ?? resolveLocale(language, getSystemLocale())
  const systemTheme = useSystemTheme()

  // 界面上要用**生效值**：跟随系统时要随系统实时变，不能把 `system` 原样当成亮暗。
  const effectiveThemeMode: ThemeMode = urlTheme ?? themeMode
  const theme: Theme = effectiveThemeMode === 'system' ? systemTheme : effectiveThemeMode

  return { language, themeMode, effectiveThemeMode, locale, theme }
}

/**
 * 语言与主题的读写入口。
 *
 * **必须在 `RouterProvider` 内部调用**：改偏好时要顺带把地址栏改成新值，那要走路由跳转。
 * 只需要读值、但处在路由之外的组件（`I18nProvider` 就在 provider 之上）改用 `useLocale()`。
 */
export function useAppearance(): Appearance {
  const navigate = useNavigate()
  const { language, themeMode, effectiveThemeMode, locale, theme } = useResolvedAppearance()
  const setLanguagePreference = useLanguageStore(state => state.setPreference)
  const setThemeModePreference = useAppUiStore(state => state.setThemeMode)

  /**
   * 改偏好的同时**改写**地址栏（而不是只补缺的）。
   *
   * 必须改写：地址栏是输入源，只写偏好而不动它，用户刚选定的值会立刻被地址栏里残留的旧值盖住，
   * 表现成「点了没反应」。这与 `useAppearanceUrlSync` 的「只补缺」是两件事：
   * 那里是补全，这里是用户在界面上的明确选择。
   *
   * 语言写成 `resolveLocale(next, 系统)` 而不是 `next`：地址栏里的语言只能是具体语种，
   * 表达不了「跟随系统」，所以偏好为 `system` 时落成当下解析出来的那个语种。
   * 这与 `?theme=` 不同 —— 主题参数能直接写 `system`，那里原样传即可。
   */
  const setLanguage = useCallback((next: LanguagePreference) => {
    const resolved = resolveLocale(next, getSystemLocale())
    setLanguagePreference(next)
    void navigate({
      to: '.',
      search: prev => ({ ...prev, lang: resolved }),
      replace: true,
    }).catch(() => undefined)
  }, [navigate, setLanguagePreference])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModePreference(mode)
    void navigate({
      to: '.',
      search: prev => ({ ...prev, theme: mode }),
      replace: true,
    }).catch(() => undefined)
  }, [navigate, setThemeModePreference])

  const toggleTheme = useCallback(
    () => setThemeMode(theme === 'dark' ? 'light' : 'dark'),
    [theme, setThemeMode],
  )

  return { language, themeMode, effectiveThemeMode, locale, theme, setLanguage, setThemeMode, toggleTheme }
}

/**
 * 地址栏缺项时按偏好补上，已有的一项不碰。**整棵树只挂这一次**（在 `App` 里调用），
 * 否则每个用到 `useAppearance` 的组件都会各自发一次 `replace`。
 *
 * 为什么用 effect 而不是让路由的 `beforeLoad` 顺手兜住：`beforeLoad` 只在导航时跑，
 * 而这里有相当一部分触发源是**状态变化**（服务端设置到手后偏好才更新），那发生在渲染之后，
 * 导航生命周期里根本看不到。放在 effect 里，两条触发路径才走同一段代码。
 *
 * 判据是「地址里到底有没有这一项」，已有的一律不碰：别人手写的地址
 * （`/router?theme=dark`、`/router`）只补缺失的那一项，不覆盖他写好的那一项。
 */
export function useAppearanceUrlSync(): void {
  const navigate = useNavigate()
  const { lang: urlLang, theme: urlTheme } = useUrlOverrides()
  const language = useLanguageStore(state => state.preference)
  const themeMode = useAppUiStore(state => state.themeMode)

  const locale = urlLang ?? resolveLocale(language, getSystemLocale())

  useEffect(() => {
    if (urlLang && urlTheme) return

    // 主题缺失就补偏好值（`system` 也算有值）——它是一个选择，不是「没有选择」。
    void navigate({
      to: '.',
      search: prev => appearanceSearch(prev, { lang: urlLang ? null : locale, theme: urlTheme ? null : themeMode }),
      replace: true,
    }).catch(() => undefined)
  }, [locale, themeMode, urlLang, urlTheme, navigate])
}

/**
 * 系统当前是亮还是暗，并在系统切换时跟着更新。
 *
 * 独立成一个小 hook，是为了让 `useAppearance` 的依赖列表保持干净：
 * 「订阅系统主题」与「语言/主题的读写」是两件事。
 * `matchMedia` 在部分测试环境里不存在，所以订阅前先探一下。
 */
export function useSystemTheme(): Theme {
  const [systemTheme, setSystemTheme] = useState<Theme>('light')

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light')
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return systemTheme
}
