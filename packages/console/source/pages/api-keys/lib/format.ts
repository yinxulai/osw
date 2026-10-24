import type { AppTranslator } from '@/i18n/provider'
import type { ApiKeyStatus } from '../types'

/**
 * 日期类的展示一律按**界面语言**格式化，而不是运行时默认语言。
 *
 * 显式收 `locale` 而不是在内部读 `useLocale()`：这两个函数是纯函数，能在非 React 测试里直接断言。
 */
export function formatDate(locale: string, ts: number): string {
  return new Date(ts).toLocaleDateString(locale)
}

/** 过期时间的展示：`null` 读作「永不过期」，而不是一个空单元格。 */
export function formatExpiry(t: AppTranslator, locale: string, expiresTime: number | null): string {
  if (expiresTime === null) return t('apiKeys.expires.never')
  return formatDate(locale, expiresTime)
}

/**
 * 「最近使用」的展示：日期 + 时分。
 *
 * 只写日期不够用：同一把 Key 一天内被用了很多次时，「今天」这三个字没法区分
 * 「五分钟前还在用」和「早上用过一次就再没动静」。`null` 读作「从未使用」，
 * 与「永不过期」同一套写法——**空值要有词，不能是空单元格**，否则看不出是没数据还是没加载。
 */
export function formatLastUsed(t: AppTranslator, locale: string, lastUsedTime: number | null): string {
  if (lastUsedTime === null) return t('apiKeys.lastUsed.never')
  return new Date(lastUsedTime).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 状态徽标读的是**当前时刻**推导出的状态，而不是库里存的开关——过期是时间说了算的。 */
export function formatApiKeyStatus(t: AppTranslator, status: ApiKeyStatus): string {
  switch (status) {
    case 'expired':
      return t('apiKeys.status.expired')
    case 'disabled':
      return t('apiKeys.status.disabled')
    default:
      return t('apiKeys.status.enabled')
  }
}
