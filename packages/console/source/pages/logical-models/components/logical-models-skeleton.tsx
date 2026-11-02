import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** 逻辑模型页首屏骨架：顶部指标 + 一张卡片列表，形状照着真身量。 */
export function LogicalModelsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-3">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="mb-2 h-6 w-10" />
            <Skeleton className="h-2.5 w-28" />
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <Skeleton className="mb-4 h-5 w-24" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-sm" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
