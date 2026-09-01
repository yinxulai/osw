import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface SortableQueueGroupProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

/**
 * 可整组拖拽的队列分组包装器。
 * 拖拽分组头即可移动整组（组内模型在拖拽结束时统一重排）。
 */
export function SortableQueueGroup(props: SortableQueueGroupProps) {
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
        isDragging && 'z-20 overflow-visible rounded-md ring-1 ring-primary/45 bg-primary/3',
      )}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
