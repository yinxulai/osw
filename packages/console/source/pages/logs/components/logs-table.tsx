import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@common/schemas'
import { AlertTriangle, Inbox, RefreshCw, SearchX } from 'lucide-react'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, tableRowClass, TableFrame } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLocale, useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { LOG_LEVEL_META, LOG_SCOPE_LABEL_KEY, formatLogTimestamp } from '../lib/log-presentation'

const EMPTY_IDS: ReadonlySet<number> = new Set()

/**
 * 实时流里**这一帧新到的**日志行 id。
 *
 * 只认「同一视图的增量」：与上一帧有交集才算实时追加，据此让新行闪一下；换了筛选 / 翻页会整批
 * 换一批 id（与上一帧不相交），那是换视图而不是新到，不闪。首帧也不闪（避免进页面满屏闪）。
 */
function useNewLogIds(logs: readonly LogEntry[]): ReadonlySet<number> {
  const seenRef = useRef<Set<number> | null>(null)
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(EMPTY_IDS)

  useEffect(() => {
    const currentIds = logs.map(log => log.id)
    const previous = seenRef.current
    // 只保留当前这一页的 id，长时间实时追踪也不会把集合撑大。
    seenRef.current = new Set(currentIds)
    if (previous === null) return
    const overlap = currentIds.some(id => previous.has(id))
    if (!overlap) {
      setNewIds(EMPTY_IDS)
      return
    }
    const added = currentIds.filter(id => !previous.has(id))
    setNewIds(added.length > 0 ? new Set(added) : EMPTY_IDS)
  }, [logs])

  return newIds
}

function renderLoadingRows() {
  return Array.from({ length: 10 }).map((_, index) => (
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
  ))
}

function renderEmptyRow(t: AppTranslator, filtered: boolean) {
  if (filtered) {
    return <TableStateRow colSpan={3} icon={SearchX} title={t('logs.empty.filteredTitle')} description={t('logs.empty.filteredDescription')} />
  }

  return <TableStateRow colSpan={3} icon={Inbox} title={t('logs.empty.title')} description={t('logs.empty.description')} />
}

function renderErrorRow(t: AppTranslator, message: string, onRetry: () => void) {
  return (
    <TableStateRow colSpan={3} icon={AlertTriangle} tone="destructive" title={t('logs.error.title')} description={message} action={
      <Button variant="outline" className="mt-1" onClick={onRetry}>
        <RefreshCw size={14} />
        {t('common.action.retry')}
      </Button>
    } />
  )
}

function renderLogRows(locale: string, t: AppTranslator, logs: LogEntry[], newIds: ReadonlySet<number>) {
  return logs.map(log => {
    const meta = LOG_LEVEL_META[log.level]
    return (
      <TableRow
        key={log.id}
        className={cn(
          tableRowClass,
          'group border-l-2 align-top transition-colors hover:bg-state-base-hover',
          meta.accentClass,
          newIds.has(log.id) && 'log-row-enter',
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
  })
}

interface LogsTableProps { logs: LogEntry[]; loading: boolean; error: string | null; filtered: boolean; onRetry: () => void }

export function LogsTable(props: LogsTableProps) {
  const { logs, loading } = props
  const t = useTranslation()
  const locale = useLocale()
  const newIds = useNewLogIds(logs)

  const renderTableBody = () => {
    if (loading) return renderLoadingRows()
    if (props.error !== null && logs.length === 0) return renderErrorRow(t, props.error, props.onRetry)
    if (logs.length === 0) return renderEmptyRow(t, props.filtered)
    return renderLogRows(locale, t, logs, newIds)
  }

  return (
    <TableFrame className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Table className="w-full table-fixed text-xs">
          <TableHeader className={cn('sticky top-0 z-10 bg-card/95 backdrop-blur-sm', tableHeaderClass)}>
            <TableRow className="h-8">
              <TableHead className={cn(tableHeaderCellClass, 'h-auto w-36 py-1.5')}>{t('logs.table.time')}</TableHead>
              <TableHead className={cn(tableHeaderCellClass, 'h-auto w-20 py-1.5')}>{t('logs.table.level')}</TableHead>
              <TableHead className={cn(tableHeaderCellClass, 'h-auto py-1.5')}>{t('logs.table.message')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{renderTableBody()}</TableBody>
        </Table>
      </div>
    </TableFrame>
  )
}
