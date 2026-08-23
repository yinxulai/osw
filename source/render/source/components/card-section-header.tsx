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
        actions && 'sm:flex-row sm:items-start sm:justify-between sm:space-y-0',
        className,
      )}
    >
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </CardHeader>
  )
}
