import * as React from 'react'
import { Braces, CheckCircle2, Copy, Gauge, Route, XCircle } from 'lucide-react'
import type { RequestLogDetail, RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  PROTOCOL_LABEL,
  STATUS_LABEL,
  formatDuration,
  formatNumber,
  formatTPS,
  formatTTFT,
} from '../lib/format'
import { RequestContentsDrawer } from './request-contents-drawer'

interface RequestLogDetailRowProps {
  log: RequestLogEntry | RequestLogDetail
  modelName: string
  detailLoading: boolean
  detailError: string | null
}
interface StatusBadgeProps {
  status: string
}

interface AttemptBadgeProps {
  attempt: RequestLogEntryAttempt
}

interface ProviderRouteProps {
  attempts: RequestLogEntryAttempt[]
  onSelect: (attemptId: string) => void
}

interface MetricCardProps {
  label: string
  value: string
  hint?: string
  accent?: boolean
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  cancelled: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
}

export function RequestStatusBadge(props: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn('font-normal', STATUS_BADGE[props.status] ?? '')}>
      {STATUS_LABEL[props.status] ?? props.status}
    </Badge>
  )
}

function AttemptBadge(props: AttemptBadgeProps) {
  const ok = props.attempt.status === 'success'

  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 gap-1 px-1.5 font-mono text-[10px] font-medium',
        ok
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/15 text-red-600 dark:text-red-400',
      )}
    >
      {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {ok ? '成功' : '失败'}
    </Badge>
  )
}

function MetricCard(props: MetricCardProps) {
  return (
    <div className="rounded-lg bg-inset px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{props.label}</div>
      <div className={cn('mt-1 font-mono text-base font-medium tabular-nums', props.accent && 'text-foreground')}>
        {props.value}
      </div>
      {props.hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{props.hint}</div>}
    </div>
  )
}

function ProviderRoute(props: ProviderRouteProps) {
  return (
    <section className="overflow-hidden rounded-lg bg-inset">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Route size={12} />
          Provider 路由
        </div>
        <span className="text-[10px] text-muted-foreground">{props.attempts.length} 次尝试</span>
      </div>
      <div className="divide-y divide-border">
        {props.attempts.map((attempt, index) => (
          <button type="button" key={attempt.attemptIndex} className="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted/40" onClick={() => props.onSelect(attempt.id)}>
            <div className={cn(
              'flex size-6 items-center justify-center rounded-full font-mono text-[10px]',
              attempt.status === 'success'
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-red-500/15 text-red-600',
            )}>
              {index + 1}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{attempt.providerName}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{attempt.providerModelName}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {PROTOCOL_LABEL[attempt.upstreamProtocol ?? ''] ?? attempt.upstreamProtocol ?? '协议未知'}
                </span>
                <AttemptBadge attempt={attempt} />
              </div>
              <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                Upstream request ID：{attempt.upstreamRequestId || '-'}
              </div>
            </div>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(attempt.durationMilliseconds)}
            </div>
          </button>
        ))}
        {props.attempts.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有生成 Provider attempt 记录</div>
        )}
      </div>
    </section>
  )
}

function RawUsage(props: Pick<RequestLogEntry, 'rawUsage' | 'cacheCreationInputTokens' | 'totalTokens'>) {
  const rawUsage = props.rawUsage ? JSON.stringify(props.rawUsage, null, 2) : null

  return (
    <section className="overflow-hidden rounded-lg bg-inset">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
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
        <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-5 text-foreground/90">{rawUsage}</pre>
      ) : (
        <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
          <Gauge size={18} className="opacity-50" />
          Provider response 不包含 usage 信息
        </div>
      )}
      <div className="border-t border-border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
        缓存写入 {formatNumber(props.cacheCreationInputTokens)} · 总 Token {formatNumber(props.totalTokens)}
      </div>
    </section>
  )
}

export function RequestLogDetailRow(props: RequestLogDetailRowProps) {
  const { log, modelName } = props
  const upstreamProtocol = log.upstreamProtocol
    ?? log.attempts.find(attempt => attempt.status === 'success')?.upstreamProtocol
    ?? log.attempts[0]?.upstreamProtocol
  const tps = formatTPS(log.outputTokens, log.totalDurationMilliseconds, log.ttftMilliseconds)
  const contents = 'contents' in log ? log.contents : null
  const [selectedAttemptId, setSelectedAttemptId] = React.useState<string | null>(null)

  return (
    <tr className="bg-muted/20">
      <td colSpan={10} className="border-b border-border p-0">
        <div className="bg-card px-5 py-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Route size={14} className="text-primary" />
                <span className="text-sm font-medium">请求执行详情</span>
                <RequestStatusBadge status={log.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span>{modelName}</span><span>·</span>
                <span>
                  请求协议：{PROTOCOL_LABEL[log.clientProtocol] ?? log.clientProtocol}
                  {upstreamProtocol && upstreamProtocol !== log.clientProtocol ? (
                    <>
                      {' '}→{' '}
                      <span className="text-amber-600 dark:text-amber-400">
                        Upstream 协议：{PROTOCOL_LABEL[upstreamProtocol] ?? upstreamProtocol}（经协议转换）
                      </span>
                    </>
                  ) : <span className="text-muted-foreground/70"> · 原生协议</span>}
                </span><span>·</span>
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
            <ProviderRoute attempts={log.attempts} onSelect={setSelectedAttemptId} />
            <RawUsage
              rawUsage={log.rawUsage}
              cacheCreationInputTokens={log.cacheCreationInputTokens}
              totalTokens={log.totalTokens}
            />
          </div>
          <RequestContentsDrawer
            contents={contents}
            conversions={'conversions' in log ? log.conversions : null}
              clientProtocol={log.clientProtocol}
              upstreamProtocol={upstreamProtocol}
            loading={props.detailLoading}
            error={props.detailError}
            selectedAttemptId={selectedAttemptId}
            onClose={() => setSelectedAttemptId(null)}
          />
        </div>
      </td>
    </tr>
  )
}
