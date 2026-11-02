import { useMemo } from 'react'
import type { AnalyticsRange, AnalyticsSummary, ProviderAnalyticsDetail } from '@common/schemas'
import type { BillContentProps } from '../components/bill-content'
import { useLocale, useTranslation } from '@/i18n/provider'
import { buildBillRows } from '../lib/bill-models'
import { formatBillRangeLabel } from '../lib/format'
import type { useBillReceipt } from './use-bill-receipt'

interface UseOverviewBillContentOptions {
  providerId?: string
  range: AnalyticsRange
  data: AnalyticsSummary | null
  providerDetail: ProviderAnalyticsDetail | null
  selectedProviderName?: string
  receipt: ReturnType<typeof useBillReceipt>
}

interface OverviewBillContent {
  statusLabel: string
  contentProps: BillContentProps
}

/**
 * 账单正文的数据装配：把总览或供应商下钻的同一批指标折成 `BillContentProps`。
 *
 * 页面只负责开合对话框，这里负责「账单上写什么」；两份数据源的字段差异也收在这一处。
 */
export function useOverviewBillContent(options: UseOverviewBillContentOptions): OverviewBillContent {
  const { providerId, range, data, providerDetail, selectedProviderName, receipt } = options
  const locale = useLocale()
  const t = useTranslation()

  const billModels = useMemo(() => {
    if (providerId) return providerDetail?.models ?? []
    return data?.modelStats ?? []
  }, [providerId, providerDetail?.models, data?.modelStats])

  const billAttempts = useMemo(
    () => billModels.reduce((total, item) => total + item.attempts, 0),
    [billModels],
  )

  // 明细行按模型名合并（理由见 `buildBillRows`）：账单没有「供应商」这一列，
  // 同一个模型被几家供应商都接进来时，拆成几行会被读成好几笔消费。
  const billRows = useMemo(() => buildBillRows(billModels, 12), [billModels])
  const summary = providerId ? providerDetail?.summary : data?.summary
  const statusLabel = receipt.stage === 'complete'
    ? t('overview.bill.status.complete')
    : receipt.stage === 'printing'
      ? t('overview.bill.status.printing')
      : t('overview.bill.status.processing')

  const contentProps: BillContentProps = {
    projectName: providerId
      ? (selectedProviderName ?? t('overview.bill.scope.provider'))
      : t('overview.bill.scope.global'),
    cashierName: 'OSW-AUTO',
    dataRangeLabel: formatBillRangeLabel(locale, range, receipt.printedAt),
    rows: billRows,
    successRate: summary?.successRate ?? 0,
    cacheHitRate: summary?.cacheHitRate ?? null,
    requestCount: providerId ? (providerDetail?.summary.attempts ?? 0) : (data?.summary.totalRequests ?? 0),
    attempts: billAttempts,
    failedCount: providerId ? (providerDetail?.summary.failed ?? 0) : (data?.summary.failedCount ?? 0),
    totalTokens: summary?.totalTokens ?? 0,
    qrDataUrl: receipt.qrDataUrl,
  }

  return { statusLabel, contentProps }
}
