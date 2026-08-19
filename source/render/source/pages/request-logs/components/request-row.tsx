import { CheckCircle2, XCircle } from 'lucide-react'
import type { RequestLogEntry } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { PROTOCOL_LABEL, STATUS_LABEL, formatTime, formatDuration } from '../lib/format'

interface RequestRowProps {
  log: RequestLogEntry
}

export function RequestRow(props: RequestRowProps) {
  const { log } = props

  const succeeded = log.status === 'success'
  const lastAttempt = log.attempts[log.attempts.length - 1]

  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
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
          <span className="font-mono text-muted-foreground">
            {lastAttempt?.upstreamModelId ?? '—'}
          </span>
          <Badge variant={succeeded ? 'success' : 'destructive'}>
            {STATUS_LABEL[log.status] ?? log.status}
          </Badge>
          <span className="text-muted-foreground">
            {PROTOCOL_LABEL[log.protocol] ?? log.protocol}
          </span>
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
                尝试{i + 1}: {attempt.providerName}/{attempt.upstreamModelId} ·{' '}
                {formatDuration(attempt.durationMilliseconds)}
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
