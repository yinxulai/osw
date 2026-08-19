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
import { ArrowRight, ListTree, RefreshCw, Target } from 'lucide-react'
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
  onNavigateToModels?: () => void
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
    onNavigateToModels,
  } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const enabledCount = models.filter(model => model.enabled).length
  const coolingCount = models.filter(model => isCooling(model.providerId)).length

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle>优先级队列</CardTitle>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {logicalModelName ?? '未配置'}
            </span>
          </div>
          <CardDescription className="mt-1">
            {models.length ? `${models.length} 个模型 · ${enabledCount} 个已启用` : '添加上游模型后配置优先级和故障转移'}
            {coolingCount > 0 && <span className="text-amber-600 dark:text-amber-500"> · {coolingCount} 个冷却中</span>}
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

        </div>
      </CardHeader>
      <CardContent className="p-0">
        {models.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={event => void onDragEnd(event)}
          >
            <SortableContext items={models.map(model => model.id)} strategy={verticalListSortingStrategy}>
              <div className="overflow-x-auto overflow-y-hidden rounded-b-lg">
                <div className="grid min-h-8 min-w-xl grid-cols-[4rem_minmax(14rem,1.4fr)_minmax(9rem,1fr)_7.5rem] items-center border-b border-border/40 bg-muted/30 px-4 text-[10px] font-medium text-muted-foreground lg:min-w-176 lg:grid-cols-[4rem_minmax(14rem,1.4fr)_minmax(9rem,1fr)_minmax(8rem,.9fr)_7.5rem]">
                  <span>顺序</span>
                  <span>供应商与上游模型</span>
                  <span>性能</span>
                  <span className="hidden lg:block">健康状态</span>
                  <span className="text-right">状态</span>
                </div>
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
            description="前往模型管理添加第一个上游模型，回来后即可调整优先级和故障转移顺序。"
            action={onNavigateToModels && (
              <Button variant="outline" size="sm" onClick={onNavigateToModels}>
                添加上游模型 <ArrowRight size={13} />
              </Button>
            )}
            className="min-h-48 border-0 py-10"
          />
        )}
      </CardContent>
    </Card>
  )
}
