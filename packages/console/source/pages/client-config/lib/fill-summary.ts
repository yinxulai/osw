import type { ClientConfigFillResultItem, ClientConfigFillStatus } from '@common/client-config'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { AppTranslator } from '@/i18n/provider'

const FILL_KEYS: Record<ClientConfigFillStatus, UiCatalogKey> = {
  applied: 'clientConfig.fill.applied',
  unchanged: 'clientConfig.fill.unchanged',
  skipped: 'clientConfig.fill.skipped',
  failed: 'clientConfig.fill.failed',
}

/**
 * 一键生效的结果读成一句话。
 *
 * 逐状态计数，而不是笼统回一句「完成」：用户最需要知道的是**有几个本来就对、有几个被跳过**，
 * 否则点完看到一句绿色提示，会以为八个客户端都被改了。
 */
export function describeFill(t: AppTranslator, results: ClientConfigFillResultItem[]): string {
  const parts: string[] = []
  for (const status of Object.keys(FILL_KEYS) as ClientConfigFillStatus[]) {
    const count = results.filter(item => item.status === status).length
    if (count > 0) parts.push(t(FILL_KEYS[status], { count }))
  }
  return parts.join(' · ')
}

/** 第一条失败原因。逐条列在提示里读不完，只报第一个——用户去详情页能看到全部。 */
export function firstFillError(results: ClientConfigFillResultItem[]): string | null {
  return results.find(item => item.status === 'failed' && item.message !== '')?.message ?? null
}
