/**
 * 主进程的界面语言。
 *
 * 托盘与原生对话框都跑在主进程，拿不到渲染进程的 React context，
 * 但它们和界面必须显示同一种语言，所以真相源和渲染进程一致——
 * `settings` 表的 `language`（见 `apps/docs/product/i18n.md` §7）。
 *
 * 数据库还读不出来的时候（启动早期、初始化失败、uncaughtException）退回
 * `app.getLocale()`，保证「启动失败」这类对话框不会因为取不到配置而完全没有文案。
 * 刻意不读渲染进程的 `localStorage`：那是另一条进程的私有状态。
 */

import { app } from 'electron'
import { DEFAULT_LOCALE, resolveLocale, type LanguagePreference, type Locale } from '@common/i18n'
import { createAppTranslator } from '@common/i18n/catalogs'
import { getSettings, onSettingsChanged } from './server-host'

export type NativeTranslator = ReturnType<typeof createAppTranslator>

type NativeLocaleListener = (locale: Locale) => void

/** 已从数据库读到的用户偏好；读取前后都用 `'system'`。 */
let preference: LanguagePreference = 'system'
let locale: Locale = DEFAULT_LOCALE
let translator: NativeTranslator = createAppTranslator(DEFAULT_LOCALE)
const listeners = new Set<NativeLocaleListener>()

/**
 * `app.getLocale()` 在 ready 之前不可靠，返回 `null` 让 `resolveLocale` 落到默认语言。
 * 主进程可能在任何阶段崩溃，这里不能抛。
 */
function systemLocale(): string | null {
  try {
    return app.isReady() ? app.getLocale() : null
  } catch {
    return null
  }
}

function applyLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  translator = createAppTranslator(next)
  for (const listener of listeners) {
    try {
      listener(next)
    } catch (error) {
      console.error('[i18n] native locale listener failed', error)
    }
  }
}

/** 当前生效语言。 */
export function nativeLocale(): Locale {
  return locale
}

/** 当前生效的取词函数；实例稳定，可以放进菜单构建逻辑里反复调用。 */
export function nativeTranslator(): NativeTranslator {
  return translator
}

/** 订阅语言变化，返回取消订阅函数。托盘用它重建菜单。 */
export function onNativeLocaleChanged(listener: NativeLocaleListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 读取 `settings.language` 并订阅后续变更。
 *
 * 必须在服务端启动完成后调用：数据库没起来时只能退回系统语言，
 * 这里读失败不算致命，只留一条诊断日志。
 */
export async function startNativeLanguageSync(): Promise<() => void> {
  try {
    const settings = await getSettings()
    preference = settings.language
  } catch (error) {
    console.warn('[i18n] settings unavailable, falling back to system locale', error)
  }
  applyLocale(resolveLocale(preference, systemLocale()))

  return onSettingsChanged(settings => {
    preference = settings.language
    applyLocale(resolveLocale(preference, systemLocale()))
  })
}
