import { useLocale, useTranslation } from '@/i18n/provider'
import { formatBillCount, formatBillPercent, formatBillTokens } from '../lib/format'

/** 账单里的一行用量：`usageTokens` / `cacheHitRate` 为 `null` 时按「无数据」占位，不隐藏整行。 */
export type BillRow = {
  id: string
  name: string
  usageTokens: number | null
  cacheHitRate: number | null
}

export type BillContentProps = {
  projectName: string
  cashierName: string
  dataRangeLabel: string
  rows: BillRow[]
  successRate: number
  cacheHitRate: number | null
  requestCount: number
  attempts: number
  failedCount: number
  totalTokens: number
  qrDataUrl: string
}

/**
 * 账单正文。
 *
 * 抽成组件是因为同一份内容要在两个地方出现：对话框里那台会走纸的打印机，
 * 以及导出 PNG 用的离屏场景。两边必须是**同一段 JSX**——否则导出的图和屏幕上看到的
 * 会随着后续改动慢慢分叉。
 */
export function BillContent(props: BillContentProps) {
  const locale = useLocale()
  const t = useTranslation()
  const { projectName, cashierName, dataRangeLabel, rows, successRate, cacheHitRate, requestCount, attempts, failedCount, totalTokens, qrDataUrl } = props

  return (
    <>
      <header className="text-center">
        <h1 className="font-semibold text-sm uppercase tracking-[0.2em]">{t('overview.bill.header')}</h1>
        <p className="mt-1 text-[0.625rem] uppercase tracking-widest opacity-60">OSW Local AI Gateway</p>
      </header>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.7rem] leading-5 opacity-75">
        <span>{t('overview.bill.meta.project')}</span>
        <span className="truncate">{projectName}</span>
        <span>{t('overview.bill.meta.cashier')}</span>
        <span>{cashierName}</span>
        <span>{t('overview.bill.meta.timeRange')}</span>
        <span>{dataRangeLabel}</span>
      </div>

      <div className="my-5 border-current border-t border-dashed opacity-30" />

      <div className="mb-2 grid grid-cols-[1fr_auto] gap-4 text-[0.625rem] tracking-wide opacity-60">
        <span>{t('overview.bill.charges.item')}</span>
        <span>{t('overview.bill.charges.usage')}</span>
      </div>

      <dl className="space-y-3 text-xs">
        {rows.map(row => (
          <div key={row.id} className="flex justify-between gap-4">
            <dt className="min-w-0 truncate">{row.name}</dt>
            <dd className="tabular-nums">{row.usageTokens == null ? '—' : formatBillTokens(row.usageTokens)} / {row.cacheHitRate == null ? '—' : formatBillPercent(row.cacheHitRate)}</dd>
          </div>
        ))}
      </dl>

      <div className="my-5 border-current border-t border-dashed opacity-30" />

      <dl className="space-y-2 text-xs">
        <div className="flex justify-between gap-4 opacity-70">
          <dt>{t('overview.stats.successRate')}</dt>
          <dd className="tabular-nums">{formatBillPercent(successRate)}</dd>
        </div>
        <div className="flex justify-between gap-4 opacity-70">
          <dt>{t('overview.stats.cacheHitRate')}</dt>
          <dd className="tabular-nums">{cacheHitRate == null ? '—' : formatBillPercent(cacheHitRate)}</dd>
        </div>
        <div className="flex justify-between gap-4 opacity-70">
          <dt>{t('overview.stats.totalRequests')}</dt>
          <dd className="tabular-nums">{formatBillCount(locale, requestCount)}</dd>
        </div>
        <div className="flex justify-between gap-4 opacity-70">
          <dt>{t('overview.bill.summaryItem')}</dt>
          <dd className="tabular-nums">{formatBillCount(locale, attempts)}</dd>
        </div>
        <div className="flex justify-between gap-4 opacity-70">
          <dt>{t('overview.bill.failed')}</dt>
          <dd className="tabular-nums">{formatBillCount(locale, failedCount)}</dd>
        </div>
        <div className="relative flex justify-between gap-4 pt-2 font-semibold text-base">
          <dt>{t('overview.bill.total')}</dt>
          <dd className="tabular-nums text-2xl font-black leading-none tracking-tight text-zinc-900">{formatBillTokens(totalTokens)}</dd>
          <span className="pointer-events-none absolute -top-11 right-3 inline-flex -rotate-12 flex-col items-center border-2 border-[#e23f35] px-2 py-1 text-center text-[#e23f35] opacity-90">
            <span className="grid w-32 grid-cols-3 px-0.5 text-[2.3rem] font-black leading-none">
              <span className="flex items-center justify-center scale-x-125">O</span>
              <span className="flex items-center justify-center scale-x-125">S</span>
              <span className="flex items-center justify-center scale-x-125">W</span>
            </span>
            <span className="mt-1 inline-flex w-32 justify-center text-[0.5rem] font-semibold tracking-[0.08em] leading-none">Local AI Gateway</span>
          </span>
        </div>
      </dl>

      <div className="mt-8 flex flex-col items-center gap-2">
        {qrDataUrl
          ? <img src={qrDataUrl} alt="OSW QR" className="h-24 w-24 rounded-sm border border-black/20 bg-white p-1" draggable={false} />
          : <div className="h-24 w-24 rounded-sm border border-black/20 bg-white" />}
        <p className="text-[0.625rem] tracking-wide opacity-70">https://osw.yinxulai.com/</p>
      </div>
    </>
  )
}
