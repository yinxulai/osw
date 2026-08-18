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
import { FlaskConical, ListTree, RefreshCw, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SortableBinding } from './sortable-binding'
import { QueueModelRow } from './queue-model-row'
import { queueModelMetricKey, type QueueModelMetrics } from '../lib/model-metrics'
import type { UpstreamModel, Provider, ProviderHealth } from '@common/schemas'

export type ProviderMap = Record<string, Provider>
export type HealthMap = Record<string, ProviderHealth>

interface QueueListCardProps {
  models: UpstreamModel[]
  providers: ProviderMap
  health: HealthMap
  modelMetrics: Record<string, QueueModelMetrics>
  logicalModelName?: string
  mode: 'auto' | 'manual'
  manualModelId: string
  isCooling: (providerId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: UpstreamModel) => void
  onToggleEnabled: (model: UpstreamModel, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
  onOpenTestPanel: () => void
}

export function QueueListCard(props: QueueListCardProps) {
  const {
    models,
    providers,
    health,
    modelMetrics,
    logicalModelName,
    mode,
    manualModelId,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
    onOpenTestPanel,
  } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <Card>
      <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <CardTitle>优先级队列</CardTitle>
          <CardDescription className="mt-1">
            队列 {logicalModelName ?? '尚未配置'}，拖拽后立即生效
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={mode} onValueChange={value => onModeChange(value as 'auto' | 'manual')}>
            <TabsList className="h-7">
              <TabsTrigger value="auto" className="h-6 px-2.5 text-[11px]">
                <RefreshCw size={12} /> 自动转移
              </TabsTrigger>
              <TabsTrigger value="manual" className="h-6 px-2.5 text-[11px]">
                <Target size={12} /> 手动指定
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button variant="outline" size="sm" onClick={onOpenTestPanel}>
            <FlaskConical size={12} /> 全局测试
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {models.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={event => void onDragEnd(event)}
          >
            <SortableContext items={models.map(model => model.id)} strategy={verticalListSortingStrategy}>
              <div className="-mx-4 -mb-4 overflow-hidden rounded-b-lg divide-y border-t">
                {models.map(model => {
                  const cooling = isCooling(model.providerId)
                  const selected = mode === 'manual' && manualModelId === model.id

                  return (
                    <SortableBinding key={model.id} id={model.id}>
                      {(handleProps, dragging) => (
                        <QueueModelRow
                          model={model}
                          provider={providers[model.providerId]}
                          providerHealth={health[model.providerId]}
                          metrics={modelMetrics[queueModelMetricKey(model.providerId, model.upstreamModelId)]}
                          mode={mode}
                          selected={selected}
                          cooling={cooling}
                          dragging={dragging}
                          dragHandleProps={handleProps}
                          onSelect={() => void onSelectManualModel(model)}
                          onToggleEnabled={enabled => void onToggleEnabled(model, enabled)}
                        />
                      )}
                    </SortableBinding>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <EmptyState
            icon={ListTree}
            title="队列中还没有模型"
            description="在模型管理中添加上游模型后，可在这里调整优先级和故障转移顺序。"
            className="-mx-4 -mb-4 min-h-40 border-t py-7"
          />
        )}
      </CardContent>
    </Card>
  )
}
