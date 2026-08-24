import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  embedded?: boolean
}

/** Compatibility wrapper built from the official shadcn Empty primitives. */
export function EmptyState(props: EmptyStateProps) {
  const { icon: Icon, title, description, action, className, embedded = false } = props

  return (
    <Empty className={cn(
      'flex-none px-6',
      embedded ? 'min-h-32 py-8' : 'min-h-44 py-10',
      className,
    )}>
      <EmptyHeader>
        <EmptyMedia variant="default" className={cn(
          'mb-0 text-muted-foreground/60 [&_svg:not([class*="size-"])]:size-auto',
          embedded ? 'size-8' : 'size-9',
        )}>
          <Icon size={embedded ? 24 : 30} strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription className="mt-0 max-w-sm leading-5">{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent className="mt-0">{action}</EmptyContent>}
    </Empty>
  )
}
