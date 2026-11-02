import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

export interface AsyncStateEmpty {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export interface AsyncStateProps {
  /** 读取中。优先级最高：加载中绝不显示空态或错误态。 */
  loading: boolean
  /** 仅在列表/主体为空时有意义；有数据时调用方应传 `null`，不要把已有内容盖掉。 */
  error?: string | null
  /** 空数据。传 `false` 表示有内容。 */
  empty?: boolean
  /** 空态内容；`empty` 为 `true` 时必填。 */
  emptyState?: AsyncStateEmpty
  /** 页面自己的骨架；不传则用统一的卡片骨架。 */
  loadingFallback?: ReactNode
  /** 错误标题；默认「数据加载失败」。 */
  errorTitle?: string
  onRetry?: () => void
  /** 卡片/面板内的小空态用 `true`，整页空态用默认值。 */
  embedded?: boolean
  className?: string
  children: ReactNode
}

/**
 * 异步区块的三态边界。
 *
 * 顺序固定为 **加载 → 错误 → 空 → 内容**：
 * 加载中先出现空态是最常见的假象——每次刷新都闪一下「暂无数据」，
 * 用户分不清是「真的没有」还是「还没读到」。错误态只在主体为空时由调用方传入，
 * 已有数据却遇到后台刷新失败时，不应把整块内容换掉（与表格三态的规则一致，
 * 见 `apps/docs/specs/design/design-system-data-display.md` §5.2）。
 */
export function AsyncState(props: AsyncStateProps) {
  const t = useTranslation()

  if (props.loading) {
    return <>{props.loadingFallback ?? <AsyncStateSkeleton />}</>
  }

  if (props.error) {
    return (
      <EmptyState
        embedded={props.embedded}
        className={props.className}
        icon={AlertTriangle}
        title={props.errorTitle ?? t('common.state.loadFailed')}
        description={props.error}
        action={props.onRetry ? (
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            <RefreshCw size={14} />
            {t('common.action.retry')}
          </Button>
        ) : undefined}
      />
    )
  }

  if (props.empty && props.emptyState) {
    return (
      <EmptyState
        embedded={props.embedded}
        className={props.className}
        icon={props.emptyState.icon}
        title={props.emptyState.title}
        description={props.emptyState.description}
        action={props.emptyState.action}
      />
    )
  }

  return <>{props.children}</>
}

interface AsyncStateSkeletonProps {
  /** 骨架块数，默认 4；长列表页面按一屏能看到的块数给。 */
  rows?: number
  className?: string
}

/** 统一的页面级骨架：标题条 + 说明条 + 内容块，形状贴近真实卡片。 */
export function AsyncStateSkeleton(props: AsyncStateSkeletonProps) {
  const t = useTranslation()
  const rows = props.rows ?? 4

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.state.loading')}
      className={cn('space-y-3', props.className)}
    >
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-xl border border-module-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="mb-2 h-3 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}
