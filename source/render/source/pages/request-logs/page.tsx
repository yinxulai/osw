import { Fragment, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Zap,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  XCircle,
  CheckCircle2,
  Route,
  Braces,
  Gauge,
  Copy,
} from 'lucide-react'
import type { RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { useRequestLogsService } from './service'
import { PROTOCOL_LABEL, STATUS_LABEL, formatTime, formatDuration, formatNumber, formatTTFT, formatTPS } from './lib/format'

type StatusFilter = 'all' | 'success' | 'failed' | 'cancelled'

interface StatusBadgeProps {
  status: string
}

interface AttemptBadgeProps {
  attempt: RequestLogEntryAttempt
}

interface DetailRowProps {
  log: RequestLogEntry
  modelName: string
}

interface MetricCardProps {
  label: string
  value: string
  hint?: string
  accent?: boolean
}

const STATUS_BADGE: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
}

function StatusBadge(props: StatusBadgeProps) {
  const { status } = props

  return (
    <Badge variant="outline" className={cn('font-normal', STATUS_BADGE[status] ?? '')}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

function AttemptBadge(props: AttemptBadgeProps) {
  const { attempt } = props

  const ok = attempt.status === 'success'
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 gap-1 px-1.5 font-mono text-[10px] font-medium',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {ok ? '成功' : '失败'}
    </Badge>
  )
}

function MetricCard(props: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-background/80 px-3 py-2.5 shadow-sm shadow-black/[0.02]">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{props.label}</div>
      <div className={cn('mt-1 font-mono text-base font-semibold tabular-nums', props.accent && 'text-emerald-600 dark:text-emerald-400')}>
        {props.value}
      </div>
      {props.hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{props.hint}</div>}
    </div>
  )
}

function DetailRow(props: DetailRowProps) {
  const { log, modelName } = props
  const tps = formatTPS(log.outputTokens, log.totalDurationMilliseconds, log.ttftMilliseconds)
  const rawUsage = log.rawUsage ? JSON.stringify(log.rawUsage, null, 2) : null

  return (
    <tr className="bg-muted/20">
      <td colSpan={10} className="border-b p-0">
        <div className="border-l-2 border-l-primary/50 bg-gradient-to-r from-primary/[0.035] to-transparent px-5 py-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Route size={14} className="text-primary" />
                <span className="text-sm font-semibold">请求执行详情</span>
                <StatusBadge status={log.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span>{modelName}</span>
                <span>·</span>
                <span>{PROTOCOL_LABEL[log.protocol] ?? log.protocol}</span>
                <span>·</span>
                <span className="font-mono">{log.id}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={event => {
                event.stopPropagation()
                void navigator.clipboard.writeText(log.id)
              }}
            >
              <Copy size={12} />
              复制 ID
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <MetricCard label="总耗时" value={formatDuration(log.totalDurationMilliseconds)} />
            <MetricCard label="首字延迟" value={formatTTFT(log.ttftMilliseconds)} />
            <MetricCard label="输出速度" value={tps === '—' ? '—' : `${tps} t/s`} accent={tps !== '—'} />
            <MetricCard label="输入 Token" value={formatNumber(log.inputTokens)} />
            <MetricCard label="输出 Token" value={formatNumber(log.outputTokens)} />
            <MetricCard
              label="缓存读取"
              value={formatNumber(log.cachedInputTokens)}
              hint={log.promptCacheHit === null ? '未知' : log.promptCacheHit ? 'Prompt Cache 命中' : '未命中'}
              accent={log.promptCacheHit === true}
            />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
            <section className="overflow-hidden rounded-lg border bg-background/80">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Route size={12} />
                  上游路由
                </div>
                <span className="text-[10px] text-muted-foreground">{log.attempts.length} 次尝试</span>
              </div>
              <div className="divide-y">
                {log.attempts.map((attempt, index) => (
                  <div key={attempt.attemptIndex} className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-xs">
                    <div className={cn(
                      'flex size-6 items-center justify-center rounded-full border font-mono text-[10px]',
                      attempt.status === 'success'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                        : 'border-red-500/30 bg-red-500/10 text-red-600',
                    )}>
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{attempt.providerName}</span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">{attempt.upstreamModelId}</span>
                        <AttemptBadge attempt={attempt} />
                      </div>
                      {attempt.errorMessage && (
                        <div className="mt-1 flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400">
                          <XCircle size={11} className="mt-0.5 shrink-0" />
                          <span className="break-all">{attempt.errorMessage}</span>
                        </div>
                      )}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatDuration(attempt.durationMilliseconds)}
                    </div>
                  </div>
                ))}
                {log.attempts.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有生成上游尝试记录</div>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border bg-background/80">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Braces size={12} />
                  原始 Usage
                </div>
                {rawUsage && (
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={event => {
                      event.stopPropagation()
                      void navigator.clipboard.writeText(rawUsage)
                    }}
                  >
                    复制 JSON
                  </button>
                )}
              </div>
              {rawUsage ? (
                <pre className="max-h-56 overflow-auto p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                  {rawUsage}
                </pre>
              ) : (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
                  <Gauge size={18} className="opacity-50" />
                  上游响应不包含 usage 信息
                </div>
              )}
              <div className="border-t bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
                缓存写入 {formatNumber(log.cacheCreationInputTokens)} · 总 Token {formatNumber(log.totalTokens)}
              </div>
            </section>
          </div>
        </div>
      </td>
    </tr>
  )
}

export function RequestLogsPage() {
  const { logs, loading, refreshing, getModelName, refresh } = useRequestLogsService()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchText, setSearchText] = useState('')

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (statusFilter !== 'all' && log.status !== statusFilter) return false
      if (searchText) {
        const q = searchText.toLowerCase()
        const lastAttempt = log.attempts[log.attempts.length - 1]
        return (
          getModelName(log.logicalModelId).toLowerCase().includes(q) ||
          log.id.toLowerCase().includes(q) ||
          log.attempts.some(
            a =>
              a.providerName.toLowerCase().includes(q) ||
              a.upstreamModelId.toLowerCase().includes(q),
          ) ||
          (lastAttempt?.errorMessage?.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
  }, [logs, statusFilter, searchText, getModelName])

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的代理请求，以及每次请求实际使用的上游模型与失败切换情况"
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
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索队列、提供商、上游模型、错误..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="h-8 w-64 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            共 {filteredLogs.length} 条
          </span>
        </div>

        {/* 表格 */}
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
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
                            'cursor-pointer border-b last:border-b-0 transition-colors hover:bg-muted/30',
                            expanded && 'bg-muted/20',
                          )}
                        >
                          <td className="px-2.5 py-2 text-muted-foreground">
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </td>
                          <td className="px-2.5 py-2">
                            <StatusBadge status={log.status} />
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
                              <Badge variant="outline" className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
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
                        {expanded && <DetailRow log={log} modelName={getModelName(log.logicalModelId)} />}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
