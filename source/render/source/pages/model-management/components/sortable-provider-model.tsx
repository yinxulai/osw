import type { ReactNode } from 'react'
import { defaultAnimateLayoutChanges, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface SortableProviderModelProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

export function SortableProviderModel(props: SortableProviderModelProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: args => {
      // 避免被拖拽项在释放时出现异常回弹动画；其余项保持正常布局过渡。
      if (args.wasDragging) return false
      return defaultAnimateLayoutChanges(args)
    },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative overflow-hidden rounded-md bg-card',
        isDragging && 'z-10 overflow-visible ring-1 ring-primary/45 bg-primary/3',
      )}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
