import * as React from 'react'
import { AlertCircle, Braces, CheckCircle2, ChevronDown, Copy, Gauge, LoaderCircle, Route, X, XCircle } from 'lucide-react'
import type { RequestContent, RequestLogDetail, RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
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

interface UpstreamRouteProps {
  attempts: RequestLogEntryAttempt[]
  onSelect: (attemptId: string) => void
}

interface MetricCardProps {
  label: string
  value: string
  hint?: string
  accent?: boolean
}

interface RequestContentsProps {
  contents: RequestContent[] | null
  attempts: RequestLogEntryAttempt[]
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  onClose: () => void
}

interface ConversionRecord {
  convertedRequestBody?: string | null
  convertedResponseBody?: string | null
}

interface ContentSectionProps {
  label: string
  value: string
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
      <div className={cn('mt-1 font-mono text-base font-medium tabular-nums', props.accent && 'text-emerald-600 dark:text-emerald-400')}>
        {props.value}
      </div>
      {props.hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{props.hint}</div>}
    </div>
  )
}

function UpstreamRoute(props: UpstreamRouteProps) {
  return (
    <section className="overflow-hidden rounded-lg bg-inset">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Route size={12} />
          上游路由
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
                <AttemptBadge attempt={attempt} />
              </div>
              <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                上游请求 ID：{attempt.providerRequestId || '-'}
              </div>
            </div>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(attempt.durationMilliseconds)}
            </div>
          </button>
        ))}
        {props.attempts.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有生成上游尝试记录</div>
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
        <pre className="max-h-56 overflow-auto p-3 font-mono text-[11px] leading-5 text-muted-foreground">{rawUsage}</pre>
      ) : (
        <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
          <Gauge size={18} className="opacity-50" />
          上游响应不包含 usage 信息
        </div>
      )}
      <div className="border-t border-border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
        缓存写入 {formatNumber(props.cacheCreationInputTokens)} · 总 Token {formatNumber(props.totalTokens)}
      </div>
    </section>
  )
}

function ContentSection(props: ContentSectionProps) {
  const [open, setOpen] = React.useState(true)

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-left text-[11px] font-medium hover:bg-muted/50"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span>{props.label}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border bg-inset p-3 font-mono text-[11px] leading-5 text-muted-foreground">
          {props.value}
        </pre>
      )}
    </div>
  )
}

function RequestContents(props: RequestContentsProps) {
  const selectedContent = props.contents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  const conversion = selectedContent?.conversions ? JSON.parse(selectedContent.conversions) as ConversionRecord : null
  const drawerSections = selectedContent ? [
    ['请求头', selectedContent.requestHeaders],
    ['请求正文', selectedContent.requestBody],
    ...(conversion?.convertedRequestBody ? [['转换后请求', conversion.convertedRequestBody]] : []),
    ...(conversion?.convertedResponseBody ? [['转换后响应', conversion.convertedResponseBody]] : []),
    ['响应头', selectedContent.responseHeaders],
    ['响应正文', selectedContent.responseBody],
  ] as Array<[string, string | null]> : []

  return (
    <>
    <div className={cn('fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l bg-card shadow-2xl transition-transform duration-200', props.selectedAttemptId ? 'translate-x-0' : 'translate-x-full')}>
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-xs font-medium">{selectedContent ? `上游尝试 ${(props.attempts.find(attempt => attempt.id === props.selectedAttemptId)?.attemptIndex ?? 0) + 1} 正文` : '正文详情'}</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">按采集时的原始字符串展示</p>
          </div>
          <button type="button" aria-label="关闭正文" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={props.onClose}><X size={14} /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-auto p-4">
          {props.loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />正在加载正文</div>
          ) : props.error ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-red-600 dark:text-red-400"><AlertCircle size={14} />{props.error}</div>
          ) : selectedContent ? (
            drawerSections.map(([label, value]) => value && <ContentSection key={label} label={label} value={value} />)
          ) : props.selectedAttemptId ? (
            <div className="py-8 text-center text-xs text-muted-foreground">该尝试没有正文记录</div>
          ) : null}
        </div>
      </div>
    </div>
    {props.selectedAttemptId && <button type="button" aria-label="关闭正文" className="fixed inset-0 z-40 bg-black/30" onClick={props.onClose} />}
    </>
  )
}

export function RequestLogDetailRow(props: RequestLogDetailRowProps) {
  const { log, modelName } = props
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
                  {PROTOCOL_LABEL[log.protocol] ?? log.protocol}
                  {log.upstreamProtocol && log.upstreamProtocol !== log.protocol && (
                    <>
                      {' '}→{' '}
                      <span className="text-amber-600 dark:text-amber-400">
                        {PROTOCOL_LABEL[log.upstreamProtocol] ?? log.upstreamProtocol}（经协议转换）
                      </span>
                    </>
                  )}
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
            <UpstreamRoute attempts={log.attempts} onSelect={setSelectedAttemptId} />
            <RawUsage
              rawUsage={log.rawUsage}
              cacheCreationInputTokens={log.cacheCreationInputTokens}
              totalTokens={log.totalTokens}
            />
          </div>
          <RequestContents contents={contents} attempts={log.attempts} loading={props.detailLoading} error={props.detailError} selectedAttemptId={selectedAttemptId} onClose={() => setSelectedAttemptId(null)} />
        </div>
      </td>
    </tr>
  )
}
