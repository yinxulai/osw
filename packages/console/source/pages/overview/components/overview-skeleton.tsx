import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { UsageDistributionMode } from './usage-distribution'

interface OverviewSkeletonProps {
  mode: UsageDistributionMode
}

/** 统计分析首屏骨架：卡片形状照着真身，数据到位时页面不跳。 */
export function OverviewSkeleton(props: OverviewSkeletonProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg bg-inset p-3">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="h-44 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </Card>
        {/* 用量分布：骨架照着真图的形状铺（热力图 175 格 = 25 列 × 7 行，接近 30 天的 181 格；
            柱状图是 h-44 的一整块）。外面套的 `h-44` 与真图一致，两张卡片不会在数据到位时跳一下高度。 */}
        <Card className="p-4">
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="mb-3 h-3 w-40" />
          <div className="flex h-44 flex-col justify-center">
            {props.mode === 'heatmap' ? (
              <div className="mx-auto grid w-full gap-0.75" style={{ gridTemplateColumns: 'repeat(25, minmax(0, 1fr))' }}>
                {Array.from({ length: 175 }).map((_, index) => (
                  <Skeleton key={index} className="aspect-square w-full rounded-[2px]" />
                ))}
              </div>
            ) : (
              <Skeleton className="h-44 w-full" />
            )}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    </div>
  )
}

/** 供应商下钻页骨架：指标行 + 明细表 + 两张图。 */
export function OverviewProviderSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-60 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  )
}
