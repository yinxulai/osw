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
        bordered && 'border-b border-border/60 px-4 py-4',
        actions && 'flex flex-row items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {actions && <div className="shrink-0 self-start">{actions}</div>}
    </CardHeader>
  )
}
