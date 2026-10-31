import type { RequestStatus } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * 状态那一格：一枚徽标，进行中写阶段名，已结束写结局名。
 *
 * 曾经这里画过一把五格的进度尺（路由 → 建连 → 等响应头 → 等首字节 → 交付），
 * 想让人一眼看出「卡在第几段」。实际用下来那五格既读不出来也占版面：绝大多数请求
 * 三秒内跑完，格子还没来得及数就满了；而真正回答「卡在哪」的是展开区的时间轴，
 * 那里每一段都带着时刻与耗时。所以这一列只留结论。
 *
 * 形状仍然对两种行一致（同一枚徽标、同一个位置）：一条请求落定那一刻只换文字与颜色，
 * 整行不换面孔。
 */
export interface StatusBadgeProps {
  status: RequestStatus
  /** 徽标上的那句话：进行中写阶段名，已结束写结局名。 */
  label: string
}

/** 落定之后按结果给色，与已结束的行共用同一套成色。 */
const STATUS_BADGE_CLASS: Record<RequestStatus, string> = {
  pending: 'bg-info/10 text-info',
  success: 'bg-success/10 text-text-success',
  failed: 'bg-destructive/10 text-text-destructive',
  cancelled: 'bg-inset text-text-tertiary',
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn('font-normal', STATUS_BADGE_CLASS[props.status])}>
      {props.label}
    </Badge>
  )
}
