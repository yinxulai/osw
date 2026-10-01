/**
 * i18n 基础类型与语言枚举。
 *
 * 只放「语言是什么」这类零依赖的声明，解析与取词逻辑在 `./index.ts`。
 * 语言目录本身不在这里，见 `./catalogs/`。
 */

/** 界面支持的语言。目录与打包语言包都以这个列表为准。 */
export const LOCALES = ['en', 'zh-CN'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * 目录缺失 key 时的回退语言。
 *
 * 同时是「系统语言无法识别」时的兜底：诊断输出固定英文，界面也以英文为安全默认，
 * 避免在无法判断用户语言时抛出不认识的语种。
 */
export const DEFAULT_LOCALE: Locale = 'en'

/** 语言在设置里的取值：`system` 表示跟随操作系统。 */
export const LANGUAGE_PREFERENCES = ['system', ...LOCALES] as const

export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number]

/**
 * 一条消息的值：单串，或按 `Intl.PluralRules` 的复数类别分档。
 *
 * 中文只有 `other` 一档，用单串即可；英文等需要 `one` / `other`。
 */
export type MessageValue = string | Partial<Record<Intl.LDMLPluralRule, string>>

/** 一个语言的完整目录。key 规范见 `apps/docs/specs/i18n.md` §4。 */
export type Catalog = Record<string, MessageValue>

/** 插值参数：整句作为一条消息，变量用 `{name}` 占位。 */
export type TranslateParams = Record<string, string | number>
