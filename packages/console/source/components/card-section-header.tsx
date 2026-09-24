import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CardDescription, CardHeader, CardTitle } from './ui/card'

interface CardSectionHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  bordered?: boolean
  compact?: boolean
}

export function CardSectionHeader(props: CardSectionHeaderProps) {
  const { title, description, actions, className, bordered = false, compact = false } = props

  return (
    <CardHeader
      className={cn(
        compact ? 'pb-1.5' : 'pb-3',
        bordered && 'border-b border-border/50 px-4 py-4',
        actions && 'flex flex-row items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {/*
        容器自己带 8px 间距：调用方图省事会把两个 `Button` 直接塞进 Fragment，那两个就会贴成一颗
        （`ContentCard` 的「撤销改动 / 保存内容」正是这么撞上的）。`self-start` 与 `items-center`
        各管一半：前者让控件与标题顶对齐，后者让控件彼此对齐。
      */}
      {actions && <div className="flex shrink-0 items-center gap-2 self-start">{actions}</div>}
    </CardHeader>
  )
}
