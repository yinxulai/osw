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
