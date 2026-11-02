import type { LatencyBucket } from '@common/schemas'
import { formatLatencyBinTick } from '@common/analytics-buckets'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { CardSectionHeader } from '@/components/card-section-header'
import { useTranslation, type AppTranslator } from '@/i18n/provider'

/** X 轴上最多写几个刻度：档数由窗口 p95 推出（6～10 档），全写出来会与邻座叠字。 */
const MAX_TICK_COUNT = 6

function buildChartConfig(t: AppTranslator): ChartConfig {
  return {
    count: { label: t('overview.latency.count'), color: 'hsl(var(--success))' },
  }
}

function resolveTickInterval(bucketCount: number): number {
  return Math.max(0, Math.ceil(bucketCount / MAX_TICK_COUNT) - 1)
}

interface LatencyDistributionProps {
  buckets: LatencyBucket[]
}

interface LatencyTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: LatencyBucket }>
}

function LatencyTooltip(props: LatencyTooltipProps) {
  const { active, label, payload } = props
  const t = useTranslation()
  if (!active || !label || !payload?.length) return null
  const bucket = payload[0]?.payload
  if (!bucket) return null

  return (
    <div className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 py-2 system-xs-regular backdrop-blur-[5px]">
      <div className="system-xs-medium text-text-primary">TTFT {bucket.range}</div>
      <div className="mt-1.5 flex items-center justify-between gap-6">
        <span className="text-text-tertiary">{t('overview.latency.count')}</span>
        <span className="font-mono system-xs-medium tabular-nums text-text-primary">
          {bucket.count}（{bucket.percent}%）
        </span>
      </div>
    </div>
  )
}

export function LatencyDistribution(props: LatencyDistributionProps) {
  const { buckets } = props
  const t = useTranslation()

  return (
    <Card className="min-w-0">
      <CardSectionHeader title={t('overview.latency.title')} description={t('overview.latency.description')} compact />
      <CardContent className="pt-1">
        {buckets.length === 0 ? (
          <div className="flex min-h-44 items-center justify-center system-xs-regular text-text-tertiary">
            {t('overview.latency.empty')}
          </div>
        ) : (
          <ChartContainer config={buildChartConfig(t)} className="aspect-auto h-44 w-full">
            <BarChart data={buckets} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="range"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={resolveTickInterval(buckets.length)}
                tickFormatter={value => formatLatencyBinTick(String(value))}
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
