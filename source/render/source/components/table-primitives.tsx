import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const tableHeaderClass = 'border-b border-border/70 bg-muted/30 text-left text-[10px] font-medium text-muted-foreground'
export const tableHeaderCellClass = 'px-3 py-2 font-medium'
export const tableCellClass = 'px-3 py-2.5'
export const tableRowClass = 'border-b border-border/60 transition-colors last:border-0 hover:bg-muted/20'

interface TableFrameProps {
  children: ReactNode
  className?: string
}

export function TableFrame(props: TableFrameProps) {
  return <div className={cn('overflow-hidden rounded-lg border border-border bg-card', props.className)}>{props.children}</div>
}

export function TableViewport(props: TableFrameProps) {
  return <div className={cn('overflow-x-auto', props.className)}>{props.children}</div>
}

export function TableHeaderSurface(props: TableFrameProps) {
  return <div className={cn(tableHeaderClass, props.className)}>{props.children}</div>
}
