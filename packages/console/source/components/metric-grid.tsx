import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { InfoHint } from '@/components/info-hint'
import { cn } from '@/lib/utils'

export interface MetricItem {
  label: string
  value: ReactNode
  Icon?: ComponentType<LucideProps>
  /**
   * 口径说明：这个数是怎么算出来的。压在标签右侧的 info 图标上，不占卡片正文
   * ——指标卡只有「标签 + 数值」两行，解释活在悬停里。
   */
  info?: string
}

interface MetricGridProps {
  items: MetricItem[]
  className?: string
}

export function MetricGrid(props: MetricGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', props.className)}>
      {props.items.map(item => (
        <div key={item.label} className="min-w-35 rounded-lg border border-module-border bg-card p-3">
          <div className="mb-1 flex items-center gap-1.5 system-xs-regular text-text-tertiary">
            {item.Icon && <item.Icon size={13} aria-hidden />}
            {item.label}
            {item.info && <InfoHint text={item.info} />}
          </div>
          <div className="system-xl-semibold tabular-nums text-text-primary">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
