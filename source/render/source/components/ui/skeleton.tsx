import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton(props: SkeletonProps) {
  const { className } = props

  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted/60',
        className,
      )}
    />
  )
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg bg-card p-4">
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="mb-2 h-8 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

interface TableSkeletonProps {
  rows?: number
  cols?: number
}

export function TableSkeleton(props: TableSkeletonProps) {
  const { rows = 5, cols = 4 } = props

  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cn('h-8', j === 0 ? 'w-8' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-card p-3">
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  )
}

interface ListSkeletonProps {
  items?: number
}

export function ListSkeleton(props: ListSkeletonProps) {
  const { items = 4 } = props

  return (
    <div className="divide-y rounded-lg bg-card">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  )
}
