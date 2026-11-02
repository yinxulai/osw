import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@common/schemas'
import { tableHeaderCellClass, tableHeaderClass, TableFrame } from '@/components/table-primitives'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { LogRow, LogsEmptyRow, LogsErrorRow, LogsLoadingRows } from './logs-table-rows'

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

interface LogsTableProps {
  logs: LogEntry[]
  loading: boolean
  error: string | null
  filtered: boolean
  onRetry: () => void
}

export function LogsTable(props: LogsTableProps) {
  const { logs, loading } = props
  const t = useTranslation()
  const newIds = useNewLogIds(logs)

  const renderTableBody = () => {
    // 顺序固定：加载 → 错误（仅无数据）→ 空 → 数据。加载中绝不显示「暂无数据」。
    if (loading) return <LogsLoadingRows />
    if (props.error !== null && logs.length === 0) return <LogsErrorRow message={props.error} onRetry={props.onRetry} />
    if (logs.length === 0) return <LogsEmptyRow filtered={props.filtered} onRefresh={props.onRetry} />
    return logs.map(log => <LogRow key={log.id} log={log} newIds={newIds} />)
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
