/**
 * 语言目录注册表。
 *
 * `common/i18n/index.ts` 是纯逻辑、不依赖任何文案；目录放在这里，谁需要文案谁 import。
 * 这样主进程（托盘、菜单、对话框）和渲染进程可以共用同一份目录，不必各自维护一套。
 */

import { createTranslator, type Translator } from '../index'
import { DEFAULT_LOCALE, type Catalog, type Locale, type MessageValue } from '../types'
import { uiEn } from './ui.en'
import { uiZhCN } from './ui.zh-CN'

export { uiEn, uiZhCN }
export type { MessageValue }

/** 界面目录的键集合：以英文目录为准。 */
export type UiCatalogKey = keyof typeof uiEn

/** 界面目录的类型：键与英文目录一致，值允许按复数分档。 */
export type UiCatalog = Record<UiCatalogKey, MessageValue>

/** 基础文案，供 `apps/docs/specs/i18n.md` §4 的 key 规范之外的自定义插值使用。 */
export const CATALOGS: Record<Locale, Catalog> = {
  en: uiEn,
  'zh-CN': uiZhCN,
}

export function getCatalog(locale: Locale): Catalog {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]
}

/**
 * 构造带目录的取词函数。
 *
 * 返回 `Translator<UiCatalogKey>`：业务代码里 `t('...')` 的 key 会在编译期校验，
 * 拼错不会静默返回一个 key 字符串。始终以英文目录作为回退——中文漏翻时给出英文原文，
 * 好过在界面上露出一个 key。
 */
export function createAppTranslator(locale: Locale): Translator<UiCatalogKey> {
  return createTranslator<UiCatalogKey>({
    locale,
    catalog: getCatalog(locale),
    fallbackCatalog: uiEn,
    fallbackLocale: 'en',
  })
}
