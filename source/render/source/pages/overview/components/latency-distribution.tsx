import type { LatencyBucket } from '@common/schemas'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { CardSectionHeader } from '@/components/card-section-header'

const chartConfig = {
  count: { label: '请求数', color: 'hsl(var(--success))' },
} satisfies ChartConfig

interface LatencyDistributionProps {
  buckets: LatencyBucket[]
}

interface LatencyTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: LatencyBucket }>
}

function formatAxisTick(value: string): string {
  const [start] = value.split('-')
  return start ?? value
}

function LatencyTooltip(props: LatencyTooltipProps) {
  const { active, label, payload } = props
  if (!active || !label || !payload?.length) return null
  const bucket = payload[0]?.payload
  if (!bucket) return null

  return (
    <div className="rounded-lg bg-muted px-3 py-2 text-xs">
      <div className="font-medium">TTFT {bucket.range}</div>
      <div className="mt-1.5 flex items-center justify-between gap-6">
        <span className="text-muted-foreground">请求数</span>
        <span className="font-mono font-medium tabular-nums">
          {bucket.count}（{bucket.percent}%）
        </span>
      </div>
    </div>
  )
}

export function LatencyDistribution(props: LatencyDistributionProps) {
  const { buckets } = props

  return (
    <Card className="min-w-70">
      <CardSectionHeader title="TTFT 分布" description="按 p95 均分区间" compact />
      <CardContent className="pt-1">
        {buckets.length === 0 ? (
          <div className="flex min-h-44 items-center justify-center text-xs text-muted-foreground">
            暂无 TTFT 数据
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full">
            <BarChart data={buckets} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="range"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={1}
                tickFormatter={value => formatAxisTick(String(value))}
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={36}
                allowDecimals={false}
                fontSize={11}
              />
              <Tooltip content={<LatencyTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
