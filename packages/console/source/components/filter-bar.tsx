import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FilterBarProps {
  children: ReactNode
  className?: string
  /**
   * 截图锚点。局部取景靠它选中整条筛选栏（见 `apps/app/source/screenshot-sets.ts` 的
   * `clip.selector`）。用专门的 `data-screenshot` 而不是复用结构选择器，是为了改布局时
   * 截图不会默默取错元素。
   */
  dataScreenshot?: string
}

export function FilterBar(props: FilterBarProps) {
  return <div data-screenshot={props.dataScreenshot} className={cn('flex flex-wrap items-center gap-2', props.className)}>{props.children}</div>
}
