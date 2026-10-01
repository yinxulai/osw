/**
 * 命令行的终端语言。
 *
 * 规则与 `apps/app/source/i18n.ts` 完全一致（真相源是 `settings.language`，读不出来时退回
 * 宿主语言，见 `apps/docs/product/i18n.md` §7 与 `apps/docs/product/packaging.md` §5.6）。差别只有一处：
 * 「宿主语言」怎么取——Electron 有 `app.getLocale()`，命令行只有环境变量与 `Intl`。
 *
 * 这个文件**刻意不静态 import core**（settings 模块链会静态加载 `node:sqlite`）：入口静态
 * 引用了它，一旦静态贯通，Node 版本不够时用户看到的是模块解析栈，而不是
 * 「node:sqlite 不可用」那句提示（见 `commands/start.ts` 的能力探测）。
 */

import { DEFAULT_LOCALE, resolveLocale, type LanguagePreference, type Locale } from '@common/i18n'
import { createAppTranslator } from '@common/i18n/catalogs'

export type CliTranslator = ReturnType<typeof createAppTranslator>

/** 数据库读出来之前的偏好固定按 `'system'` 算。 */
let preference: LanguagePreference = 'system'
let locale: Locale = DEFAULT_LOCALE
let translator: CliTranslator = createAppTranslator(DEFAULT_LOCALE)

function firstNonEmpty(...candidates: (string | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return null
}

/**
 * 系统语言。
 *
 * 先看 POSIX 环境变量：它表达的是「用户为这个终端选的语言」，比 `Intl` 报的
 * 「操作系统当前语言」更贴近命令行里的预期（SSH、容器、`LANG=C` 的场景下两者经常不一致）。
 * 都取不到时返回 `null`，交给 `resolveLocale` 落到默认语言。
 */
export function systemLocale(): string | null {
  const fromEnvironment = firstNonEmpty(process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG)
  if (fromEnvironment) return fromEnvironment
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return null
  }
}

/** 用系统语言初始化。必须在解析出任何用户可见输出之前调用。 */
export function applySystemLocale(): void {
  applyLocale(resolveLocale(preference, systemLocale()))
}

/** 当前生效语言。 */
export function cliLocale(): Locale {
  return locale
}

/** 当前生效的取词函数。调用方应每次现取，不要缓存到模块作用域。 */
export function cliTranslator(): CliTranslator {
  return translator
}

/**
 * 读 `settings.language` 并跟随后续变更，返回取消订阅函数。
 *
 * 必须在服务启动之后调用。读失败不算致命：终端输出继续用系统语言，只留一条诊断日志
 * ——命令行的输出已经发出去了，为了取词去中断一个正在跑的服务不划算。
 */
export async function startCliLanguageSync(): Promise<() => void> {
  const { getSettings, onSettingsChanged } = await import('@server/database/settings-store')
  try {
    preference = (await getSettings()).language
  } catch (error) {
    console.warn('[cli] settings unavailable, falling back to system locale', error)
  }
  applyLocale(resolveLocale(preference, systemLocale()))

  return onSettingsChanged(settings => {
    preference = settings.language
    applyLocale(resolveLocale(preference, systemLocale()))
  })
}

function applyLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  translator = createAppTranslator(next)
}
