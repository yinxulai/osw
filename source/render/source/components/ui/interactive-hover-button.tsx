import * as React from 'react'
import { ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'

interface InteractiveHoverButtonProps extends React.ComponentProps<'button'> {
  hoverContent?: React.ReactNode
}

function InteractiveHoverButton({
  children,
  className,
  hoverContent,
  ...props
}: InteractiveHoverButtonProps) {
  return (
    <button
      data-slot="interactive-hover-button"
      className={cn(
        'group relative inline-flex h-8 w-auto cursor-pointer items-center overflow-hidden rounded-full border border-border bg-background px-4 text-center text-xs font-medium text-foreground outline-none transition-colors select-none hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="flex items-center justify-center gap-2">
        <span className="size-2 rounded-full bg-foreground transition-transform duration-300 motion-reduce:transition-none group-hover:scale-[100.8] group-focus-visible:scale-[100.8]" />
        <span className="inline-block transition-all duration-300 motion-reduce:transition-none group-hover:translate-x-12 group-hover:opacity-0 group-focus-visible:translate-x-12 group-focus-visible:opacity-0">
          {children}
        </span>
      </span>
      <span className="absolute inset-0 z-10 flex translate-x-12 items-center justify-center gap-2 text-background opacity-0 transition-all duration-300 motion-reduce:transition-none group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
        {hoverContent ?? (
          <>
            <span>{children}</span>
            <ArrowRight className="size-3.5" />
          </>
        )}
      </span>
    </button>
  )
}

export { InteractiveHoverButton }
