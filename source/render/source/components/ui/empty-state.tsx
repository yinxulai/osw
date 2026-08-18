import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  embedded?: boolean
}

export function EmptyState(props: EmptyStateProps) {
  const { icon: Icon, title, description, action, className, embedded = false } = props

  return (
    <div className={cn('flex min-h-44 flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className={cn(
        'mb-3 flex size-9 items-center justify-center text-muted-foreground/60',
      )}>
        <Icon size={30} strokeWidth={1.5} />
      </div>
      <div className="text-xs font-medium">{title}</div>
      {description && <div className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
