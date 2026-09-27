import { useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { UsageHeatBucket } from '@common/schemas'
import { formatTrendTooltipLabel, resolveUsageHeatLevels, trendCrossesDays } from '@common/analytics-buckets'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { formatCount, formatPercent, formatTokens } from '../lib/format'

/** 热力档 → 类名。写成字面量数组而不是 `` `bg-heat-${level}` ``：Tailwind 扫不出拼接出来的类名。 */
const HEAT_CLASSES = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4'] as const

/** 格子的最大边长。再大就像色块墙了，贡献图一格也就十来个像素。 */
const CELL_MAX_SIZE = 26

/** 格子间距，与下面 `gap-0.75` 是同一个数（算块宽时要用到）。 */
const HEAT_GAP = 3

/**
 * 图表区的固定高度（`h-44` = 176px），与柱状图的 `ChartContainer` 一致。
 *
 * 热力图的自然高度由行数推出来（今日 5 行、近 7 天 / 近 30 天 6 行），柱状图是一整块
 * `h-44`；不锁死的话同一张卡片切模式、切范围时高度都会跳，整行布局跟着重排。
 * `ProviderDistribution` 用的是同一个数，两张卡并排时不互相拉扯。
 */
export const HEAT_AREA_HEIGHT = 176

/** 图例那一行占的高度（`mt-3` 间距 + 一行 10px 的色块），算格子高度上限时要先扣掉。 */
const LEGEND_HEIGHT = 30

/**
 * 块的形状：宽约是高的 {@link HEAT_BLOCK_ASPECT} 倍。
 *
 * 一格一桶，格数由范围的**完整时长**决定（今日 144、近 7 天 169、近 30 天 181，见
 * `HEAT_TARGET_CELLS`）。排成一行得一百多列，每格不到 6px，细得像一堆头发丝；
 * 所以要折行，而且折成横条——卡片是 1:2 的宽卡，块也横着才不空。
 * 行数由这个比例倒推（宽卡的可用宽度约是高度的 3 倍），列数再按行数均分。
 */
const HEAT_BLOCK_ASPECT = 6

/** 按桶数推列数：先按形状定行数，再把桶均摊到行上。 */
function resolveHeatColumns(count: number): number {
  if (count <= 0) return 1
  const rows = Math.max(1, Math.ceil(Math.sqrt(count / HEAT_BLOCK_ASPECT)))
  return Math.ceil(count / rows)
}

interface UsageHeatGridProps {
  /** 一格一桶，桶清单来自 `@common/analytics-buckets` 的 `resolveHeatBuckets`（空桶由服务端补零）。 */
  buckets: UsageHeatBucket[]
}

/**
 * 用量分布的热力图本体：颜色深浅表示一桶里的请求量。卡片外壳与模式切换在 `UsageDistribution`。
 *
 * 与柱状图的分工：柱状图读的是「这段时间里用量怎么起伏」，还能拆出输入 / 输出 / 缓存的构成，
 * 但桶一多就只剩一片柱林；热力图读的是「哪些时段在干活」，连续的空白、半夜的加班一眼看出来，
 * 代价是丢了构成（token 用量退到 tooltip 里）。两种都留着，交给用的人自己挑。
 *
 * **粒度跟着页面上方的时间范围走**：今日 10 分钟一格、近 7 天 1 小时一格、近 30 天 4 小时
 * 一格，格数与格宽都由服务端随响应带回。窗口按完整时长铺满，所以今日白天就能看到 24 小时
 * 的格子，没到的时间段是空格子；这里不自己切时间轴，也不写死按天——写死的话「今日」只会
 * 剩一个格子，「近 7 天」也读不出半夜与白天的差别。
 */
export function UsageHeatGrid(props: UsageHeatGridProps) {
  const { buckets } = props
  const t = useTranslation()
  const [hovered, setHovered] = useState<{ bucket: UsageHeatBucket; rect: DOMRect } | null>(null)

  // 档位按**非零桶的分位数**切，不是按最大值等分：用量是重尾分布，某个桶撞上一个超长上下文
  // 会把其余所有桶压成同一个浅色。规则在 `@common/analytics-buckets`。
  const levelOf = useMemo(() => resolveUsageHeatLevels(buckets.map(bucket => bucket.requests)), [buckets])
  const bucketByLabel = useMemo(() => new Map(buckets.map(bucket => [bucket.label, bucket])), [buckets])
  const crossesDays = useMemo(() => trendCrossesDays(buckets.map(bucket => bucket.label)), [buckets])

  const columns = resolveHeatColumns(buckets.length)
  const rows = Math.max(1, Math.ceil(buckets.length / columns))
  // 格子边长同时受宽、高两条约束：宽是 `CELL_MAX_SIZE`，高是把整块塞进固定高度的图表区
  // （扣掉图例那一行）。两者取小，所以 5 行与 6 行的块高度一致，切范围时不会长高。
  const cellSize = Math.min(
    CELL_MAX_SIZE,
    Math.floor((HEAT_AREA_HEIGHT - LEGEND_HEIGHT - (rows - 1) * HEAT_GAP) / rows),
  )
  // 块宽按「格子 + 间距」算死：格子在宽卡里不会被摊成扁平的长方块，桶少时块也不会
  // 被拉满整张卡——`mx-auto` 把它居中。窗口太窄时 `w-full` 兜底，格子跟着缩。
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    maxWidth: columns * cellSize + (columns - 1) * HEAT_GAP,
  }

  const handlePointerOver = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest('[data-heat-label]')
    if (!(target instanceof HTMLElement)) return
    const bucket = bucketByLabel.get(target.dataset.heatLabel ?? '')
    if (!bucket || hovered?.bucket.label === bucket.label) return
    setHovered({ bucket, rect: target.getBoundingClientRect() })
  }

  return (
    <>
      {/* 没有请求的桶也照画（0 档），服务端保证清单连续、至少一格，所以这里不做空状态。 */}
      <div
        className="mx-auto grid w-full gap-0.75"
        style={gridStyle}
        role="img"
        aria-label={t('overview.heat.title')}
        onMouseOver={handlePointerOver}
        onMouseLeave={() => setHovered(null)}
      >
        {buckets.map(bucket => (
          <div
            key={bucket.label}
            data-heat-label={bucket.label}
            className={cn(
              'aspect-square w-full rounded-[2px] hover:outline-1 hover:outline-solid hover:outline-offset-1 hover:outline-text-quaternary',
              HEAT_CLASSES[levelOf(bucket.requests)],
            )}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 system-2xs-regular text-text-tertiary">
        <span>{t('overview.heat.legend.less')}</span>
        {HEAT_CLASSES.map(heatClass => (
          <span key={heatClass} className={cn('size-2.5 rounded-[2px]', heatClass)} />
        ))}
        <span>{t('overview.heat.legend.more')}</span>
      </div>

      {hovered && createPortal(<HeatTooltip bucket={hovered.bucket} rect={hovered.rect} crossesDays={crossesDays} />, document.body)}
    </>
  )
}

interface HeatTooltipProps {
  bucket: UsageHeatBucket
  /** 触发格的视口坐标。tooltip 挂在 `document.body` 上，所以只能用视口坐标 + `fixed`。 */
  rect: DOMRect
  crossesDays: boolean
}

interface TooltipRowProps {
  label: string
  value: string
}

/**
 * 挂在 `document.body` 上的浮层，不用卡片内的绝对定位：`Card` 是 `overflow-hidden` 的，
 * 图上边那几格的 tooltip 会被卡片裁掉。
 *
 * 样式沿用仓库统一的浮层配方（0.5px 边框 + 半透明底 + 背景模糊），不用 `shadow-*`。
 */
function HeatTooltip(props: HeatTooltipProps) {
  const { bucket, rect, crossesDays } = props
  const t = useTranslation()
  const locale = useLocale()
  // 格子在上半屏就往下弹，否则往上弹；左右各留出半个 tooltip 的宽度，贴着窗户边也不出界。
  const below = rect.top < 160
  const center = Math.min(Math.max(rect.left + rect.width / 2, 96), window.innerWidth - 96)
  const style: CSSProperties = {
    left: center,
    top: below ? rect.bottom + 8 : rect.top - 8,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  }

  return (
    <div style={style} className="pointer-events-none fixed z-50 min-w-44 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 py-2 system-xs-regular backdrop-blur-[5px]">
      {/* 标题沿用趋势图那套写法：桶宽是整天时只有日期，日内桶才带时刻（与柱状图同一口径）。 */}
      <div className="system-xs-medium text-text-primary">{formatTrendTooltipLabel(locale, bucket.label, crossesDays)}</div>
      <div className="mt-1.5 grid gap-1">
        <TooltipRow label={t('overview.heat.tooltip.requests')} value={formatCount(locale, bucket.requests)} />
        {/* 没有请求时成功率无意义，让位给「—」，而不是写一个 0% 出来。 */}
        <TooltipRow label={t('overview.heat.tooltip.successRate')} value={bucket.requests > 0 ? formatPercent(bucket.success / bucket.requests) : '—'} />
        <TooltipRow label={t('overview.heat.tooltip.tokens')} value={bucket.requests > 0 ? formatTokens(bucket.totalTokens) : '—'} />
      </div>
    </div>
  )
}

function TooltipRow(props: TooltipRowProps) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-text-tertiary">{props.label}</span>
      <span className="font-mono system-xs-medium tabular-nums text-text-primary">{props.value}</span>
    </div>
  )
}
