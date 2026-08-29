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
import { useEffect, useMemo, useState } from 'react'
import { Ban, Plus, Server, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProviderModelRow } from './provider-model-row'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderModelListProps {
  provider: Provider
  models: ProviderModelRoute[]
  onAddModel: () => void
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
  onRemoveModels: (models: ProviderModelRoute[]) => Promise<boolean>
  onDisableModels: (models: ProviderModelRoute[]) => Promise<boolean>
  onDragEnd: (event: DragEndEvent) => void
}

export function ProviderModelList(props: ProviderModelListProps) {
  const { provider, models, onAddModel, onEditModel, onToggleModelEnabled, onRemoveModel, onRemoveModels, onDisableModels, onDragEnd } = props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [modelSearch, setModelSearch] = useState('')

  useEffect(() => {
    const modelIdSet = new Set(models.map(model => model.id))
    setSelectedModelIds(current => current.filter(id => modelIdSet.has(id)))
  }, [models])

  const selectedCount = selectedModelIds.length
  const selectedSet = useMemo(() => new Set(selectedModelIds), [selectedModelIds])
  const searchKeyword = modelSearch.trim().toLowerCase()
  const visibleModels = useMemo(() => {
    if (!searchKeyword) return models
    return models.filter(model => model.modelName.toLowerCase().includes(searchKeyword))
  }, [models, searchKeyword])

  const removeSelected = async () => {
    const selectedModels = models.filter(model => selectedSet.has(model.id))
    if (selectedModels.length === 0) return
    const removed = await onRemoveModels(selectedModels)
    if (removed) setSelectedModelIds([])
  }

  const disableSelected = async () => {
    const selectedModels = models.filter(model => selectedSet.has(model.id))
    if (selectedModels.length === 0) return
    const disabled = await onDisableModels(selectedModels)
    if (disabled) setSelectedModelIds([])
  }

  return (
    <>
      <div className="border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-2">
            <Input
              className="h-7 text-xs"
              placeholder="搜索模型 ID..."
              value={modelSearch}
              onChange={event => setModelSearch(event.target.value)}
            />
          </div>
          {selectedCount > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">已选择 {selectedCount} 项</span>
              <Button variant="outline" size="sm" onClick={() => void disableSelected()}>
                <Ban size={13} /> 禁用
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void removeSelected()}>
                <Trash2 size={13} /> 删除
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={onAddModel}>
              <Plus size={13} /> 添加模型
            </Button>
          )}
        </div>
      </div>
      {models.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={event => void onDragEnd(event)}
        >
          <SortableContext items={visibleModels.map(model => model.id)} strategy={verticalListSortingStrategy}>
            <div className="overflow-hidden rounded-lg border bg-muted/35 divide-y divide-border/60">
              {visibleModels.map(model => (
                <ProviderModelRow
                  key={model.id}
                  provider={provider}
                  model={model}
                  selected={selectedSet.has(model.id)}
                  onSelectedChange={checked => {
                    setSelectedModelIds(current => checked
                      ? current.includes(model.id) ? current : [...current, model.id]
                      : current.filter(id => id !== model.id))
                  }}
                  onEditModel={onEditModel}
                  onToggleModelEnabled={onToggleModelEnabled}
                  onRemoveModel={onRemoveModel}
                />
              ))}
              {visibleModels.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  没有匹配的模型
                </div>
              )}
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
