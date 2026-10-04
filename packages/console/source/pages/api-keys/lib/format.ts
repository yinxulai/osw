import type { AppTranslator } from '@/i18n/provider'
import type { ApiKeyStatus } from '../types'

/** 过期时间的展示：`null` 读作「永不过期」，而不是一个空单元格。 */
export function formatExpiry(t: AppTranslator, expiresTime: number | null): string {
  if (expiresTime === null) return t('apiKeys.expires.never')
  return new Date(expiresTime).toLocaleDateString()
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
