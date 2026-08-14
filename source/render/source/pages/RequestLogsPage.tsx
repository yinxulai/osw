import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { requestLogApi, type RequestLogEntry } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

const PROTOCOL_LABEL: Record<string, string> = {
  'openai-completions': 'OpenAI Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function RequestRow({ log }: { log: RequestLogEntry }) {
  const succeeded = log.status === 'success'
  const lastAttempt = log.attempts[log.attempts.length - 1]
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="mt-0.5 shrink-0">
        {succeeded
          ? <CheckCircle2 size={16} className="text-emerald-500" />
          : <XCircle size={16} className="text-destructive" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">
            {lastAttempt ? lastAttempt.providerName : log.logicalModelId}
          </span>
          <span className="font-mono text-muted-foreground">{lastAttempt?.upstreamModelId ?? '—'}</span>
          <Badge variant={succeeded ? 'success' : 'destructive'}>
            {STATUS_LABEL[log.status] ?? log.status}
          </Badge>
          <span className="text-muted-foreground">{PROTOCOL_LABEL[log.protocol] ?? log.protocol}</span>
          <span className="text-muted-foreground">{formatTime(log.createdTime)}</span>
        </div>
        {log.attempts.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {log.attempts.map((attempt, i) => (
              <span
                key={i}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[11px]',
                  attempt.status === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-destructive/30 bg-destructive/10 text-destructive',
                )}
                title={attempt.errorMessage ?? undefined}
              >
                尝试{i + 1}: {attempt.providerName}/{attempt.upstreamModelId} · {formatDuration(attempt.durationMilliseconds)}
              </span>
            ))}
          </div>
        )}
        {log.attempts.length === 1 && (
          <div className="text-[11px] text-muted-foreground">
            耗时 {formatDuration(log.totalDurationMilliseconds)}
            {log.totalTokens != null ? ` · ${log.totalTokens} tokens` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

export default function RequestLogsPage() {
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setErrorMessage('')
    const result = await requestLogApi.list(50)
    if (!result.success) {
      setErrorMessage(result.errorMessage)
      setLoading(false)
      return
    }
    setLogs(result.data.logs)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的上游请求，以及每次请求实际使用的模型与失败切换情况"
        actions={
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
            <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
            刷新
          </Button>
        }
      />
      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">最近请求</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                加载中…
              </div>
            ) : errorMessage ? (
              <div className="px-4 py-8 text-sm text-destructive">{errorMessage}</div>
            ) : logs.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                暂无请求记录，发送一次代理请求后即可在此看到实际使用的模型。
              </div>
            ) : (
              <div>
                {logs.map(log => (
                  <RequestRow key={log.id} log={log} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContent>
    </PageLayout>
  )
}
