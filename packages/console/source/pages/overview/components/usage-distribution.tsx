import type { UsageHeatBucket, UsageTrendPoint } from '@common/schemas'
import { ChartColumn, Grid3x3 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/i18n/provider'
import { formatIntervalDescription } from '../lib/format'
import { TrendBars } from './trend-chart'
import { UsageHeatGrid } from './usage-heat-grid'

/** 「用量分布」的两种画法：热力图看时段，柱状图看构成与起伏。 */
export type UsageDistributionMode = 'heatmap' | 'bars'

interface UsageDistributionProps {
  mode: UsageDistributionMode
  onModeChange: (mode: UsageDistributionMode) => void
  heat: UsageHeatBucket[]
  /** 格宽，与 `AnalyticsSummary.heatIntervalMs` 是同一个数（比趋势桶细）。 */
  heatIntervalMs: number
  trend: UsageTrendPoint[]
  /** 每根柱子覆盖的时长，与 `AnalyticsSummary.trendIntervalMs` 是同一个数。 */
  trendIntervalMs: number
}

/**
 * 用量分布：一张卡片，两种画法，开关在标题行右侧。
 *
 * 为什么不二选一——两张图回答的不是同一个问题。柱状图看「这段时间的用量怎么起伏」，
 * 还能拆出输入 / 输出 / 缓存写入 / 缓存读取 / 思考的构成；热力图看「哪些时段在干活」，
 * 连续的空白、半夜的加班一眼就看出来，代价是丢了构成（一格里塞不下五段，退成请求数一档）。
 * 各有各的用处，所以都留着；默认落在热力图上（密度更高，扫一眼就能看出作息）。
 *
 * 副标题跟着模式走：两种画法的桶宽不是同一个数（热力图按完整时长铺 144 ~ 181 格、
 * 比趋势桶细一档），写死一个会让另一边的刻度对不上。
 */
export function UsageDistribution(props: UsageDistributionProps) {
  const { mode, onModeChange, heat, heatIntervalMs, trend, trendIntervalMs } = props
  const t = useTranslation()
  const heatmap = mode === 'heatmap'

  return (
    <Card data-screenshot="overview-usage" className="min-w-0 w-full">
      <CardSectionHeader
        title={t('overview.heat.title')}
        description={formatIntervalDescription(t, heatmap ? heatIntervalMs : trendIntervalMs)}
        compact
        actions={(
          <Tabs value={mode} onValueChange={value => onModeChange(value as UsageDistributionMode)}>
            <TabsList>
              <TabsTrigger value="heatmap" className="px-2.5 system-xs-medium"><Grid3x3 size={12} /> {t('overview.heat.mode.heatmap')}</TabsTrigger>
              <TabsTrigger value="bars" className="px-2.5 system-xs-medium"><ChartColumn size={12} /> {t('overview.heat.mode.bars')}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
      <CardContent className="min-w-0">
        {/*
          固定高度的图表区：两种画法的自然高度不一样（热力图按行数长、柱状图是 `h-44` 的
          `ChartContainer`），范围一变格数也变。不锁死的话切模式、切范围时整行卡片都会跳，
          右边这张卡还牵着左边的供应商分布一起重排。`justify-center` 让矮的那一种居中，
          而不是贴着顶。高度值与 `HEAT_AREA_HEIGHT` / `ProviderDistribution` 是同一个数。
        */}
        <div className="flex h-44 min-w-0 flex-col justify-center">
          {heatmap ? <UsageHeatGrid buckets={heat} /> : <TrendBars trend={trend} />}
        </div>
      </CardContent>
    </Card>
  )
}
