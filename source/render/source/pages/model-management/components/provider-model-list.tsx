import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProviderModelRow } from './provider-model-row'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderModelListProps {
  provider: Provider
  models: ProviderModelRoute[]
  onAddModel: () => void
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
  onDragEnd: (event: DragEndEvent) => void
}

export function ProviderModelList(props: ProviderModelListProps) {
  const { provider, models, onAddModel, onEditModel, onToggleModelEnabled, onRemoveModel, onDragEnd } = props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <>
      <div className="border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">供应商模型</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              每个模型一行，可同时支持多个协议；拖拽调整 default 逻辑模型中的相对优先级
            </div>
          </div>
          <Button variant="outline" onClick={onAddModel}>
            <Plus size={13} /> 添加模型
          </Button>
        </div>
      </div>
      {models.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={event => void onDragEnd(event)}
        >
          <SortableContext items={models.map(model => model.id)} strategy={verticalListSortingStrategy}>
            <div className="overflow-hidden rounded-lg border bg-muted/35 divide-y divide-border/60">
              {models.map(model => (
                <ProviderModelRow
                  key={model.id}
                  provider={provider}
                  model={model}
                  onEditModel={onEditModel}
                  onToggleModelEnabled={onToggleModelEnabled}
                  onRemoveModel={onRemoveModel}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 text-center">
          <Server size={20} className="mb-2 text-muted-foreground/40" />
          <p className="text-xs font-medium">还没有供应商模型</p>
          <p className="mt-1 text-[11px] text-muted-foreground">添加后即可通过本地代理调用</p>
        </div>
      )}
    </>
  )
}
