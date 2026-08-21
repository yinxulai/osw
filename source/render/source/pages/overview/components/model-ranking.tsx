import type { ModelStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatLatency } from '../lib/format'

interface ModelRankingProps {
  stats: ModelStat[]
}

export function ModelRanking(props: ModelRankingProps) {
  const { stats } = props

  return (
    <Card className="min-w-[400px]">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-sm">模型使用排行</CardTitle>
        <CardDescription>按请求数排序</CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-y border-border text-muted-foreground">
                <th className="text-left font-medium py-2 px-4 w-8">#</th>
                <th className="text-left font-medium py-2">模型</th>
                <th className="text-left font-medium py-2">Provider</th>
                <th className="text-right font-medium py-2 pr-4">请求数</th>
                <th className="text-right font-medium py-2">平均延迟</th>
                <th className="text-right font-medium py-2 pr-4">成功率</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">暂无数据</td>
                </tr>
              ) : stats.map((m, idx) => (
                <tr key={`${m.providerId}-${m.providerModelName}`} className="border-b border-border last:border-0">
                  <td className="py-2 px-4">
                    <span className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium',
                      idx < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}>
                      {idx + 1}
                    </span>
                  </td>
                  <td className="py-2 font-medium">{m.providerModelName}</td>
                  <td className="py-2 text-muted-foreground">{m.providerName}</td>
                  <td className="py-2 text-right pr-4 tabular-nums">{m.requests.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{formatLatency(m.avgLatencyMs)}</td>
                  <td className="py-2 text-right pr-4">
                    <Badge variant={m.successRate >= 0.95 ? 'success' : m.successRate >= 0.8 ? 'warning' : 'destructive'} className="font-normal h-5 px-1.5 text-[11px]">
                      {(m.successRate * 100).toFixed(1)}%
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
