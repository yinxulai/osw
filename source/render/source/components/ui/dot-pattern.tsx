import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'

interface DotPatternProps extends SVGProps<SVGSVGElement> {
  width?: number
  height?: number
  x?: number
  y?: number
  cr?: number
}

export function DotPattern({
  className,
  width = 22,
  height = 22,
  x = 1,
  y = 1,
  cr = 0.8,
  ...props
}: DotPatternProps) {
  const patternId = 'app-dot-pattern'

  return (
    <svg
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute right-0 top-0 h-80 w-130 text-muted-foreground/20 mask-[radial-gradient(ellipse_at_top_right,black_0%,black_34%,transparent_78%)]',
        className
      )}
      fill="none"
      {...props}
    >
      <defs>
        <pattern
          id={patternId}
          height={height}
          patternUnits="userSpaceOnUse"
          width={width}
          x={x}
          y={y}
        >
          <circle cx="1" cy="1" fill="currentColor" r={cr} />
        </pattern>
      </defs>
      <rect fill={`url(#${patternId})`} height="100%" width="100%" />
    </svg>
  )
}
