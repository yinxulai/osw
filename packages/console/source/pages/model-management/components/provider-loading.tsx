import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** 模型管理页首屏骨架：左列表 + 右详情，与真实两栏同形。 */
export function ProviderLoading() {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="min-w-0 p-3">
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="min-w-0 p-4">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-sm" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
