import { cn } from '@/lib/utils'

interface InlineEmptyStateProps {
  title: string
  description?: string
  className?: string
}

export function InlineEmptyState(props: InlineEmptyStateProps) {
  return (
    <div className={cn('px-5 py-10 text-center', props.className)}>
      <p className="text-xs font-medium">{props.title}</p>
      {props.description && <p className="mt-1 text-[11px] text-muted-foreground">{props.description}</p>}
    </div>
  )
}
