import { AlertTriangle, Inbox, RefreshCw, SearchX } from 'lucide-react'
import type { LogEntry } from '@common/schemas'
import { tableCellClass, tableRowClass } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { LOG_LEVEL_META, LOG_SCOPE_LABEL_KEY, formatLogTimestamp } from '../lib/log-presentation'

/** 10 行骨架：不超过一屏能看到的行数，列宽与真实行对应。 */
export function LogsLoadingRows() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, index) => (
        <TableRow key={index} className={cn(tableRowClass, 'border-l-2 border-l-transparent')}>
          <TableCell className="px-3 py-2">
            <Skeleton className="h-3 w-28" />
          </TableCell>
          <TableCell className="px-3 py-2">
            <Skeleton className="h-4 w-12" />
          </TableCell>
          <TableCell className="px-3 py-2">
            <Skeleton className="h-3 w-4/5" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

interface LogsEmptyRowProps {
  filtered: boolean
  onRefresh: () => void
}

/** 空态：筛选后为空与从未有过是两句不同的话；两种都给一个刷新动作。 */
export function LogsEmptyRow(props: LogsEmptyRowProps) {
  const t = useTranslation()
  const action = (
    <Button variant="outline" className="mt-1" onClick={props.onRefresh}>
      <RefreshCw size={14} />
      {t('common.action.refresh')}
    </Button>
  )

  if (props.filtered) {
    return (
      <TableStateRow
        colSpan={3}
        icon={SearchX}
        title={t('logs.empty.filteredTitle')}
        description={t('logs.empty.filteredDescription')}
        action={action}
      />
    )
  }

  return (
    <TableStateRow
      colSpan={3}
      icon={Inbox}
      title={t('logs.empty.title')}
      description={t('logs.empty.description')}
      action={action}
    />
  )
}

interface LogsErrorRowProps {
  message: string
  onRetry: () => void
}

export function LogsErrorRow(props: LogsErrorRowProps) {
  const t = useTranslation()

  return (
    <TableStateRow
      colSpan={3}
      icon={AlertTriangle}
      tone="destructive"
      title={t('logs.error.title')}
      description={props.message}
      action={(
        <Button variant="outline" className="mt-1" onClick={props.onRetry}>
          <RefreshCw size={14} />
          {t('common.action.retry')}
        </Button>
      )}
    />
  )
}

interface LogRowProps {
  log: LogEntry
  newIds: ReadonlySet<number>
}

export function LogRow(props: LogRowProps) {
  const { log } = props
  const t = useTranslation()
  const locale = useLocale()
  const meta = LOG_LEVEL_META[log.level]

  return (
    <TableRow
      className={cn(
        tableRowClass,
        'group border-l-2 align-top transition-colors hover:bg-state-base-hover',
        meta.accentClass,
        props.newIds.has(log.id) && 'log-row-enter',
      )}
    >
      <TableCell className={cn(tableCellClass, 'whitespace-nowrap py-1.5 font-mono tabular-nums text-text-quaternary')}>
        {formatLogTimestamp(log.timestamp, locale)}
      </TableCell>
      <TableCell className={cn(tableCellClass, 'py-1.5')}>
        <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 font-mono system-2xs-medium tracking-wide', meta.badgeClass)}>
          {meta.label}
        </span>
      </TableCell>
      <TableCell className={cn(tableCellClass, 'py-1.5')}>
        <div className="flex min-w-0 items-baseline gap-2">
          {/* 模块标签：一屏混着几个模块时，不用去点筛选也知道这条是谁打的。 */}
          <span className="shrink-0 rounded bg-inset px-1.5 py-px font-mono system-2xs-regular text-text-quaternary">
            {t(LOG_SCOPE_LABEL_KEY[log.scope])}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-text-secondary">{log.message}</span>
        </div>
      </TableCell>
    </TableRow>
  )
}
