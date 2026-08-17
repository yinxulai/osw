import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, XCircle } from 'lucide-react'
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
import { useRequestLogsService } from './service'
import { PROTOCOL_LABEL, STATUS_LABEL, formatTime, formatDuration } from './lib/format'

type StatusFilter = 'all' | 'success' | 'failed' | 'cancelled'

const STATUS_BADGE: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('font-normal', STATUS_BADGE[status] ?? '')}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

function AttemptBadge({ attempt }: { attempt: RequestLogEntryAttempt }) {
  const ok = attempt.status === 'success'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-mono',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
      title={attempt.errorMessage ?? undefined}
    >
      <span className="font-medium">#{attempt.attemptIndex + 1}</span>
      <span className="text-muted-foreground/70">·</span>
      <span>{attempt.providerName}/{attempt.upstreamModelId}</span>
      <span className="text-muted-foreground/70">·</span>
      <span>{formatDuration(attempt.durationMilliseconds)}</span>
    </span>
  )
}

function DetailRow({ log }: { log: RequestLogEntry }) {
  const lastAttempt = log.attempts[log.attempts.length - 1]
  return (
    <tr className="bg-muted/30">
      <td colSpan={8} className="px-4 py-3">
        <div className="space-y-3 pl-8">
          <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
            <div>
              <div className="text-muted-foreground">请求 ID</div>
              <div className="font-mono">{log.id}</div>
            </div>
            <div>
              <div className="text-muted-foreground">逻辑模型</div>
              <div className="font-medium">{log.logicalModelId}</div>
            </div>
            <div>
              <div className="text-muted-foreground">协议</div>
              <div>{PROTOCOL_LABEL[log.protocol] ?? log.protocol}</div>
            </div>
            <div>
              <div className="text-muted-foreground">总耗时</div>
              <div className="font-mono">{formatDuration(log.totalDurationMilliseconds)}</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              尝试记录（{log.attempts.length} 次）
            </div>
            <div className="space-y-1.5">
              {log.attempts.map(attempt => (
                <div
                  key={attempt.attemptIndex}
                  className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs"
                >
                  <AttemptBadge attempt={attempt} />
                  {attempt.errorMessage && (
                    <span className="flex items-center gap-1 text-red-500">
                      <XCircle size={12} />
                      {attempt.errorMessage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {log.totalTokens != null && (
            <div className="text-xs text-muted-foreground">
              总 Token：<span className="font-mono text-foreground">{log.totalTokens}</span>
            </div>
          )}

          {lastAttempt?.errorMessage && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <div className="font-medium">最终错误</div>
              <div className="font-mono mt-0.5">{lastAttempt.errorMessage}</div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

export function RequestLogsPage() {
  const { logs, loading, refreshing, errorMessage, refresh } = useRequestLogsService()
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
          log.logicalModelId.toLowerCase().includes(q) ||
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
  }, [logs, statusFilter, searchText])

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的上游请求，以及每次请求实际使用的模型与失败切换情况"
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
              placeholder="搜索模型、提供商、错误..."
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
                  <th className="w-8 px-3 py-2 font-medium" />
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">逻辑模型</th>
                  <th className="px-3 py-2 font-medium">协议</th>
                  <th className="px-3 py-2 font-medium">最终提供商/模型</th>
                  <th className="px-3 py-2 font-medium text-center">尝试</th>
                  <th className="px-3 py-2 font-medium text-right">耗时</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        加载中…
                      </div>
                    </td>
                  </tr>
                ) : errorMessage ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-destructive">
                      {errorMessage}
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      暂无匹配的请求记录
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => {
                    const lastAttempt = log.attempts[log.attempts.length - 1]
                    const expanded = expandedId === log.id
                    return (
                      <Fragment key={log.id}>
                        <tr
                          onClick={() => toggleExpand(log.id)}
                          className={cn(
                            'cursor-pointer border-b last:border-b-0 transition-colors hover:bg-muted/30',
                            expanded && 'bg-muted/20',
                          )}
                        >
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={log.status} />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-muted-foreground">
                            {formatTime(log.createdTime)}
                          </td>
                          <td className="px-3 py-2.5 font-medium">{log.logicalModelId}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {PROTOCOL_LABEL[log.protocol] ?? log.protocol}
                          </td>
                          <td className="px-3 py-2.5">
                            {lastAttempt ? (
                              <span className="font-mono">
                                <span className="text-foreground">{lastAttempt.providerName}</span>
                                <span className="text-muted-foreground"> / </span>
                                <span className="text-muted-foreground">
                                  {lastAttempt.upstreamModelId}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={cn(
                                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium',
                                log.attempts.length > 1
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {log.attempts.length}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {formatDuration(log.totalDurationMilliseconds)}
                          </td>
                        </tr>
                        {expanded && <DetailRow log={log} />}
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
