import type { FailureReasonStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface FailureReasonsProps {
  reasons: FailureReasonStat[]
  failedCount: number
  successRate: number
}

export function FailureReasons({ reasons, failedCount, successRate }: FailureReasonsProps) {
  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle>失败原因分析</CardTitle>
        <CardDescription>
          共 {failedCount.toLocaleString()} 次失败请求 · 失败率 {((1 - successRate) * 100).toFixed(2)}%
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        {reasons.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">暂无失败记录</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-0 -mx-4">
            {reasons.map((f, idx) => (
              <div
                key={f.reason}
                className={cn(
                  'px-3 py-2.5 text-center',
                  idx < reasons.length - 1 && 'border-r',
                  idx >= 2 && 'border-t sm:border-t-0 md:border-t-0'
                )}
              >
                <div className="text-lg font-semibold text-destructive tabular-nums">{f.count}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{f.reason}</div>
                <div className="h-1 bg-muted rounded-full overflow-hidden mt-2">
                  <div className="h-full bg-destructive rounded-full" style={{ width: `${f.percent}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{f.percent}%</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
