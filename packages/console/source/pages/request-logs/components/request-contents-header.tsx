import type { RequestLogEntryAttempt } from '@common/schemas'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { formatAttemptOutcome } from '../lib/format'

export interface RequestContentsHeaderProps {
  /** 选中的尝试；`null` 表示还没选中（或这次请求一次尝试都没有）。 */
  selectedAttempt: RequestLogEntryAttempt | null
  /** 这次请求总共有几次尝试，用于「第 n / m 次」。 */
  attemptCount: number
}

/**
 * 正文面板的标题栏。
 *
 * 标题里写「第几次尝试」，紧挨着的结论徽标只写结果——不再另开一行，也不在正文里复述一遍。
 */
export function RequestContentsHeader(props: RequestContentsHeaderProps) {
  const t = useTranslation()
  const { selectedAttempt } = props

  return (
    <SheetHeader className="shrink-0 border-b border-border/50 px-4 py-3.5 pr-12">
      <SheetTitle className="flex flex-wrap items-center gap-2">
        <span>{selectedAttempt ? t('requestLogs.contents.title', { index: selectedAttempt.attemptIndex + 1, total: props.attemptCount }) : t('requestLogs.contents.titleFallback')}</span>
        {/* 结果就是 HTTP 状态，与列表行用同一套徽标，Sheet 里不再另说一遍。 */}
        {selectedAttempt && (
          <span className={cn(
            'rounded-sm px-1.5 py-0.5 font-mono system-2xs-medium',
            selectedAttempt.status === 'success'
              ? 'bg-success/10 text-text-success'
              : 'bg-destructive/10 text-text-destructive',
          )}>
            {formatAttemptOutcome(t, selectedAttempt)}
          </span>
        )}
      </SheetTitle>
      <SheetDescription>
        {selectedAttempt
          ? `${selectedAttempt.providerName} / ${selectedAttempt.providerModelName}`
          : t('requestLogs.contents.description')}
      </SheetDescription>
    </SheetHeader>
  )
}
