import type { FailureReasonStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'

interface FailureReasonsProps {
  reasons: FailureReasonStat[]
  failedCount: number
  successRate: number
}

const ERROR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-pink-500',
  'bg-purple-500',
  'bg-indigo-500',
  'bg-sky-500',
]

export function FailureReasons(props: FailureReasonsProps) {
  const { reasons, failedCount, successRate } = props
  const failureRate = ((1 - successRate) * 100).toFixed(2)

  return (
    <Card className="min-w-[320px]">
      <CardSectionHeader
        title="错误分布"
        description={`共 ${failedCount.toLocaleString()} 次失败 · 失败率 ${failureRate}%`}
        compact
      />
      <CardContent className="pt-0">
        {reasons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <div className="text-2xl">✓</div>
            <div className="mt-1 text-xs">暂无错误记录</div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 横向堆叠条 */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {reasons.map((r, idx) => (
                <div
                  key={r.reason}
                  className={cn(ERROR_COLORS[idx % ERROR_COLORS.length], 'transition-all')}
                  style={{ width: `${r.percent}%` }}
                  title={`${r.reason}: ${r.count} 次 (${r.percent}%)`}
                />
              ))}
            </div>
            {/* 错误列表 */}
            <div className="space-y-2">
              {reasons.map((r, idx) => (
                <div key={r.reason} className="flex items-center gap-2.5 text-xs">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', ERROR_COLORS[idx % ERROR_COLORS.length])} />
                  <span className="min-w-0 flex-1 truncate text-foreground/80" title={r.reason}>
                    {r.reason}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                    {r.count.toLocaleString()}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-muted-foreground tabular-nums">
                    {r.percent}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
