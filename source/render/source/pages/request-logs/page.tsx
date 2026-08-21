import { Fragment, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Zap,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  ScrollText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { RequestLogDetailRow, RequestStatusBadge } from './components/request-log-detail-row'
import { useRequestLogsService, PAGE_SIZE } from './service'
import { formatTime, formatDuration, formatNumber, formatTTFT, formatTPS } from './lib/format'

type StatusFilter = 'all' | 'pending' | 'success' | 'failed' | 'cancelled'

type RequestLogsFilter = { providerId: string; logicalModelId: string; protocol: string; status: StatusFilter; createdTimeFrom: number | null; createdTimeTo: number | null }

export function RequestLogsPage() {
  const { logs, total, providers, logicalModels, loading, refreshing, details, detailLoadingIds, detailErrors, getModelName, loadDetail, refresh, setFilter } = useRequestLogsService()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [logicalModelFilter, setLogicalModelFilter] = useState<string>('all')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)

  const applyFilter = (next: Partial<RequestLogsFilter>) => {
    if (next.providerId !== undefined) setProviderFilter(next.providerId)
    if (next.logicalModelId !== undefined) setLogicalModelFilter(next.logicalModelId)
    if (next.protocol !== undefined) setProtocolFilter(next.protocol)
    if (next.status !== undefined) setStatusFilter(next.status)
    if (next.createdTimeFrom !== undefined) setFromDate(next.createdTimeFrom === null ? '' : new Date(next.createdTimeFrom).toISOString().slice(0, 10))
    if (next.createdTimeTo !== undefined) setToDate(next.createdTimeTo === null ? '' : new Date(next.createdTimeTo - 1).toISOString().slice(0, 10))
    setPage(1)
    void setFilter(next)
  }

  const providerOptions = useMemo(() => {
    return providers
      .map(p => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providers])

  const protocolOptions = ['openai-responses', 'openai-completions', 'anthropic-messages']

  const filteredLogs = logs

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    setPage(clamped)
    void refresh(clamped)
  }

  const toggleExpand = (id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id
      if (next) void loadDetail(next)
      return next
    })
  }

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的代理请求，以及每次请求实际使用的供应商模型与失败切换情况"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
            刷新
          </Button>
        }
      />
      <PageContent>
        {/* 筛选栏 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={providerFilter} onValueChange={v => applyFilter({ providerId: v })}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="全部渠道" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部渠道</SelectItem>
              {providerOptions.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={logicalModelFilter} onValueChange={v => applyFilter({ logicalModelId: v })}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="全部模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模型</SelectItem>
              {logicalModels.map(model => (
                <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={protocolFilter} onValueChange={v => applyFilter({ protocol: v })}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="全部协议" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部协议</SelectItem>
              {protocolOptions.map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => applyFilter({ status: v as StatusFilter })}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">进行中</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
            </SelectContent>
          </Select>
          <input
            aria-label="开始日期"
            type="date"
            value={fromDate}
            onChange={event => {
              const value = event.target.value
              setFromDate(value)
              applyFilter({ createdTimeFrom: value ? new Date(`${value}T00:00:00`).getTime() : null })
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
          <input
            aria-label="结束日期"
            type="date"
            value={toDate}
            onChange={event => {
              const value = event.target.value
              setToDate(value)
              applyFilter({ createdTimeTo: value ? new Date(`${value}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : null })
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">
            共 {total} 条
          </span>
        </div>

        {!loading && logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="暂无请求记录"
            description="通过本地代理发起请求后，这里会记录实际使用的模型、耗时、缓存与故障切换详情。"
            className="min-h-64"
          />
        ) : <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                  <th className="w-8 px-2.5 py-2 font-medium" />
                  <th className="px-2.5 py-2 font-medium">状态</th>
                  <th className="px-2.5 py-2 font-medium">时间</th>
                  <th className="px-2.5 py-2 font-medium">队列</th>
                  <th className="px-2.5 py-2 font-medium text-center">
                    <ArrowUpFromLine size={11} className="mr-0.5 inline" />
                    输入
                  </th>
                  <th className="px-2.5 py-2 font-medium text-center">
                    <ArrowDownToLine size={11} className="mr-0.5 inline" />
                    输出
                  </th>
                  <th className="px-2.5 py-2 font-medium text-center">
                    <Clock size={11} className="mr-0.5 inline" />
                    TTFT
                  </th>
                  <th className="px-2.5 py-2 font-medium text-center">
                    <Zap size={11} className="mr-0.5 inline" />
                    TPS
                  </th>
                  <th className="px-2.5 py-2 font-medium text-center">
                    <Database size={11} className="mr-0.5 inline" />
                    缓存
                  </th>
                  <th className="px-2.5 py-2 font-medium text-right">耗时</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-2.5 py-2.5"><Skeleton className="h-3.5 w-3.5" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="h-5 w-12" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="h-3 w-20" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="h-3 w-16" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="mx-auto h-3 w-8" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="mx-auto h-3 w-8" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="mx-auto h-3 w-10" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="mx-auto h-3 w-10" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="mx-auto h-3 w-8" /></td>
                      <td className="px-2.5 py-2.5"><Skeleton className="ml-auto h-3 w-12" /></td>
                    </tr>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                      暂无匹配的请求记录
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => {
                    const expanded = expandedId === log.id
                    const tps = formatTPS(log.outputTokens, log.totalDurationMilliseconds, log.ttftMilliseconds)
                    return (
                      <Fragment key={log.id}>
                        <tr
                          onClick={() => toggleExpand(log.id)}
                          className={cn(
                            'cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-muted/30',
                            expanded && 'bg-muted/20',
                          )}
                        >
                          <td className="px-2.5 py-2 text-muted-foreground">
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </td>
                          <td className="px-2.5 py-2">
                            <RequestStatusBadge status={log.status} />
                          </td>
                          <td className="px-2.5 py-2 font-mono text-muted-foreground whitespace-nowrap">
                            {formatTime(log.createdTime)}
                          </td>
                          <td className="px-2.5 py-2 max-w-35 truncate font-medium">
                            {getModelName(log.logicalModelId)}
                          </td>
                          <td className="px-2.5 py-2 text-center font-mono">
                            <span className={cn(log.inputTokens != null && 'text-foreground')}>
                              {formatNumber(log.inputTokens)}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-center font-mono">
                            <span className={cn(log.outputTokens != null && 'text-foreground')}>
                              {formatNumber(log.outputTokens)}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-center font-mono">
                            <span className={cn(log.ttftMilliseconds != null && 'text-foreground')}>
                              {formatTTFT(log.ttftMilliseconds)}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-center font-mono">
                            <span className={cn(tps !== '—' && 'text-emerald-600 dark:text-emerald-400')}>
                              {tps}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-center">
                            {log.cachedInputTokens === null ? (
                              <span className="text-muted-foreground/60">—</span>
                            ) : log.cachedInputTokens > 0 ? (
                              <Badge className="h-5 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                                HIT · {formatNumber(log.cachedInputTokens)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground/60">MISS</span>
                            )}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono">
                            {formatDuration(log.totalDurationMilliseconds)}
                          </td>
                        </tr>
                        {expanded && (
                          <RequestLogDetailRow
                            log={details[log.id] ?? log}
                            modelName={getModelName(log.logicalModelId)}
                            detailLoading={detailLoadingIds[log.id] ?? false}
                            detailError={detailErrors[log.id] || null}
                          />
                        )}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>}
        {!loading && total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
