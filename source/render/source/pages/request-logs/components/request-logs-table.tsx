import { Fragment } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, Clock, Database, Zap } from 'lucide-react'
import type { RequestLogDetail, RequestLogEntry } from '@common/schemas'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, TableFrame } from '@/components/table-primitives'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatDuration, formatNumber, formatTime, formatTPS, formatTTFT } from '../lib/format'
import { RequestLogDetailRow, RequestStatusBadge } from './request-log-detail-row'

interface CachedTokensCellProps {
  value: number | null
}

interface RequestLogTableRowProps {
  log: RequestLogEntry
  expanded: boolean
  detail: RequestLogDetail | undefined
  detailLoading: boolean
  detailError: string | null
  modelName: string
  toggleExpand: (id: string) => void
}

interface RequestLogsTableProps {
  logs: RequestLogEntry[]
  loading: boolean
  expandedId: string | null
  details: Record<string, RequestLogDetail>
  detailLoadingIds: Record<string, boolean>
  detailErrors: Record<string, string>
  getModelName: (id: string) => string
  toggleExpand: (id: string) => void
}

export function CachedTokensCell(props: CachedTokensCellProps) {
  if (props.value === null) {
    return <span className="text-muted-foreground/60">—</span>
  }

  if (props.value > 0) {
    return (
      <Badge className="h-5 bg-foreground/10 px-1.5 text-[10px] text-foreground">
        {formatNumber(props.value)}
      </Badge>
    )
  }

  return <span className="font-medium text-foreground/70">MISS</span>
}

function RequestLogsTableHeader() {
  return (
    <thead className={tableHeaderClass}>
      <tr>
        <th className={cn(tableHeaderCellClass, 'w-8')} />
        <th className={tableHeaderCellClass}>状态</th>
        <th className={tableHeaderCellClass}>时间</th>
        <th className={tableHeaderCellClass}>队列</th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <ArrowUpFromLine size={11} className="mr-0.5 inline" />
          输入
        </th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <Database size={11} className="mr-0.5 inline" />
          缓存输入
        </th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <ArrowDownToLine size={11} className="mr-0.5 inline" />
          输出
        </th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <Clock size={11} className="mr-0.5 inline" />
          TTFT
        </th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <Zap size={11} className="mr-0.5 inline" />
          TPS
        </th>
        <th className={cn(tableHeaderCellClass, 'text-right')}>耗时</th>
      </tr>
    </thead>
  )
}

function RequestLogsLoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, index) => (
        <tr key={index}>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3.5 w-3.5" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-5 w-12" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3 w-20" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3 w-16" />
          </td>
          {Array.from({ length: 5 }).map((__, cell) => (
            <td key={cell} className="px-2.5 py-2.5">
              <Skeleton
                className={cn(
                  'mx-auto h-3',
                  cell === 4 && 'ml-auto',
                  cell === 3 || cell === 4 ? 'w-10' : 'w-8',
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function RequestLogTableRow(props: RequestLogTableRowProps) {
  const successfulAttempt = props.log.attempts.find(attempt => attempt.status === 'success')
  const tps = formatTPS(
    props.log.outputTokens,
    successfulAttempt?.durationMilliseconds ?? props.log.totalDurationMilliseconds,
    props.log.ttftMilliseconds,
  )

  return (
    <Fragment key={props.log.id}>
      <tr
        onClick={() => props.toggleExpand(props.log.id)}
        className={cn(
          'cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-muted/20',
          props.expanded && 'bg-muted/20',
        )}
      >
        <td className={cn(tableCellClass, 'text-foreground/70')}>
          {props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className={tableCellClass}>
          <RequestStatusBadge status={props.log.status} />
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap font-mono text-foreground/75')}>
          {formatTime(props.log.createdTime)}
        </td>
        <td className={cn(tableCellClass, 'max-w-35 truncate font-medium')}>{props.modelName}</td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(props.log.inputTokens != null && 'text-foreground')}>
            {formatNumber(props.log.inputTokens)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center')}>
          <CachedTokensCell value={props.log.cachedInputTokens} />
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(props.log.outputTokens != null && 'text-foreground')}>
            {formatNumber(props.log.outputTokens)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(props.log.ttftMilliseconds != null && 'text-foreground')}>
            {formatTTFT(props.log.ttftMilliseconds)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(tps !== '—' && 'text-foreground')}>{tps}</span>
        </td>
        <td className={cn(tableCellClass, 'text-right font-mono')}>
          {formatDuration(props.log.totalDurationMilliseconds)}
        </td>
      </tr>
      {props.expanded && (
        <RequestLogDetailRow
          log={props.detail ?? props.log}
          modelName={props.modelName}
          detailLoading={props.detailLoading}
          detailError={props.detailError}
        />
      )}
    </Fragment>
  )
}

export function RequestLogsTable(props: RequestLogsTableProps) {
  let body

  if (props.loading) {
    body = <RequestLogsLoadingRows />
  } else if (props.logs.length === 0) {
    body = (
      <tr>
        <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
          暂无匹配的请求记录
        </td>
      </tr>
    )
  } else {
    body = props.logs.map(log => (
      <RequestLogTableRow
        key={log.id}
        log={log}
        expanded={props.expandedId === log.id}
        detail={props.details[log.id]}
        detailLoading={props.detailLoadingIds[log.id] ?? false}
        detailError={props.detailErrors[log.id] || null}
        modelName={props.getModelName(log.logicalModelId)}
        toggleExpand={props.toggleExpand}
      />
    ))
  }

  return (
    <TableFrame>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <RequestLogsTableHeader />
          <tbody>{body}</tbody>
        </table>
      </div>
    </TableFrame>
  )
}
