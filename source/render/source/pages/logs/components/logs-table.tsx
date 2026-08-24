import type { LogEntry } from '@common/schemas'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, tableRowClass, TableFrame } from '@/components/table-primitives'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  error: 'bg-red-500/15 text-red-600 dark:text-red-400',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  log: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  debug: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
}
const LEVEL_LABEL: Record<LogEntry['level'], string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  log: 'LOG',
  debug: 'DEBUG',
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(timestamp)
}

function renderLoadingRows() {
  return Array.from({ length: 10 }).map((_, index) => (
    <TableRow key={index} className={tableRowClass}>
      <TableCell className="px-3 py-2.5">
        <Skeleton className="h-3 w-28" />
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <Skeleton className="h-5 w-14" />
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <Skeleton className="h-3 w-4/5" />
      </TableCell>
    </TableRow>
  ))
}

function renderEmptyRow() {
  return (
    <TableRow>
      <TableCell colSpan={3} className="px-4 py-16 text-center text-muted-foreground">
        暂无匹配的运行日志
      </TableCell>
    </TableRow>
  )
}

function renderLogRows(logs: LogEntry[]) {
  return logs.map(log => (
    <TableRow key={log.id} className={cn(tableRowClass, 'align-top')}>
      <TableCell className={cn(tableCellClass, 'whitespace-nowrap font-mono text-muted-foreground')}>
        {formatTimestamp(log.timestamp)}
      </TableCell>
      <TableCell className={tableCellClass}>
        <Badge variant="outline" className={cn('h-5 px-1.5 font-mono text-[10px]', LEVEL_STYLE[log.level])}>
          {LEVEL_LABEL[log.level]}
        </Badge>
      </TableCell>
      <TableCell className={cn(tableCellClass, 'whitespace-pre-wrap break-all font-mono leading-5')}>{log.message}</TableCell>
    </TableRow>
  ))
}

interface LogsTableProps { logs: LogEntry[]; loading: boolean }

export function LogsTable(props: LogsTableProps) {
  const { logs, loading } = props

  const renderTableBody = () => {
    if (loading) return renderLoadingRows()
    if (logs.length === 0) return renderEmptyRow()
    return renderLogRows(logs)
  }

  return (
    <TableFrame>
      <div className="max-h-[calc(100vh-190px)] overflow-auto">
        <Table className="w-full table-fixed text-xs">
          <TableHeader className={cn('sticky top-0 z-10 bg-card/95 backdrop-blur-sm', tableHeaderClass)}>
            <TableRow>
              <TableHead className={cn(tableHeaderCellClass, 'w-40')}>时间</TableHead>
              <TableHead className={cn(tableHeaderCellClass, 'w-20')}>级别</TableHead>
              <TableHead className={tableHeaderCellClass}>消息</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{renderTableBody()}</TableBody>
        </Table>
      </div>
    </TableFrame>
  )
}
