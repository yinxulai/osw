import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface SortableQueueModelProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

export function SortableQueueModel(props: SortableQueueModelProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: ({ isSorting }) => isSorting,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative overflow-hidden bg-card',
        isDragging && 'z-10 overflow-visible ring-1 ring-primary/45 bg-primary/3',
      )}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
