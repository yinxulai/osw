/**
 * 渲染进程的 i18n 上下文。
 *
 * 上下文值必须 memo（`locale` 变了才换新对象）：provider 在树的高处，每次渲染都换新值
 * 会让所有 `useTranslation()` 的组件跟着重渲染。
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { resolveLocale, type Locale, type Translator } from '@common/i18n'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { useSettings } from '@/data/settings'
import { getTranslator } from './active'
import { getSystemLocale, useLanguageStore } from './store'

export type AppTranslator = Translator<UiCatalogKey>

interface I18nContextValue {
  locale: Locale
  t: AppTranslator
}

interface I18nProviderProps { children: ReactNode }

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider(props: I18nProviderProps) {
  const preference = useLanguageStore(state => state.preference)
  const setPreference = useLanguageStore(state => state.setPreference)
  const settings = useSettings()

  // 服务端设置是权威来源。设置页的改动会先写进本地状态作为预览，保存后再从这里回填（值相同，幂等）。
  useEffect(() => {
    if (settings) setPreference(settings.language)
  }, [settings, setPreference])

  const locale = useMemo(() => resolveLocale(preference, getSystemLocale()), [preference])

  // `getTranslator` 是模块级缓存：同一语言返回同一实例，所以这个 value 只在语言变化时换新。
  // 顺便把「当前语言」同步给 React 树之外（错误构造、格式化工具）使用。
  const value = useMemo<I18nContextValue>(() => ({ locale, t: getTranslator(locale) }), [locale])

  // 让浏览器的语言敏感行为（拼写检查、原生控件文案、`toLocaleString` 默认值）跟上界面语言。
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

function useI18nContext(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}

export function useI18n(): I18nContextValue {
  return useI18nContext()
}

/** 当前生效语言，供 `Intl` 格式化使用。 */
export function useLocale(): Locale {
  return useI18nContext().locale
}

/** 文案取词函数。 */
export function useTranslation(): AppTranslator {
  return useI18nContext().t
}
