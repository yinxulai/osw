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
import { useMemo } from 'react'
import { TableHeaderSurface } from '@/components/table-primitives'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SortableQueueModel } from './sortable-queue-model'
import { QueueModelRow } from './queue-model-row'
import { queueModelMetricKey, type QueueModelMetrics } from '../lib/model-metrics'
import type { ProviderModelRoute, Provider, ProviderHealth, ProviderModelHealth } from '@common/schemas'

export type ProviderMap = Record<string, Provider>
export type HealthMap = Record<string, ProviderHealth>
export type ProviderModelHealthMap = Record<string, ProviderModelHealth>

interface QueueListCardProps {
  models: ProviderModelRoute[]
  providers: ProviderMap
  health: HealthMap
  providerModelHealth: ProviderModelHealthMap
  modelMetrics: Record<string, QueueModelMetrics>
  mode: 'auto' | 'manual'
  manualModelId: string
  switchingMode: boolean
  isCooling: (providerId: string, providerModelId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: ProviderModelRoute) => void
  onToggleEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
  onNavigateToProviderAnalytics?: (providerId: string) => void
  onNavigateToModels?: () => void
}

export function QueueListCard(props: QueueListCardProps) {
  const {
    models,
    providers,
    health,
    providerModelHealth,
    modelMetrics,
    mode,
    manualModelId,
    switchingMode,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
    onNavigateToProviderAnalytics,
    onNavigateToModels,
  } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const itemIds = useMemo(() => models.map(model => model.id), [models])
  const rows = models.map(model => ({
    model,
    cooling: isCooling(model.providerId, model.id),
    selected: mode === 'manual' && manualModelId === model.id,
  }))
  const enabledCount = models.filter(model => model.enabled).length
  const coolingCount = rows.filter(row => row.cooling).length

  const renderHeader = () => (
    <CardHeader className="flex-row items-center justify-between gap-4 pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <CardTitle>模型队列</CardTitle>
        </div>
        <CardDescription className="mt-1">
          {models.length ? `${models.length} 个模型 · ${enabledCount} 个已启用` : '添加供应商模型后配置优先级和故障转移'}
          {coolingCount > 0 && <span className="text-amber-600 dark:text-amber-500"> · {coolingCount} 个冷却中</span>}
        </CardDescription>
      </div>
      <div className="flex items-center gap-2">
        <Tabs value={mode} onValueChange={value => onModeChange(value as 'auto' | 'manual')}>
          <TabsList className="h-7">
            <TabsTrigger value="auto" disabled={switchingMode} className="h-6 px-2.5 text-[11px]">
              <RefreshCw size={12} className={switchingMode ? 'animate-spin' : undefined} /> 自动转移
            </TabsTrigger>
            <TabsTrigger value="manual" disabled={switchingMode} className="h-6 px-2.5 text-[11px]">
              <Target size={12} /> 手动指定
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </CardHeader>
  )

  const renderTableHeader = () => (
    <TableHeaderSurface className="grid min-h-8 min-w-xl grid-cols-[4rem_minmax(14rem,1.4fr)_minmax(9rem,1fr)_7.5rem] items-center px-4 lg:min-w-176 lg:grid-cols-[4rem_minmax(14rem,1.4fr)_minmax(9rem,1fr)_minmax(8rem,.9fr)_7.5rem]">
      <span className="px-3 py-2">顺序</span>
      <span className="px-3 py-2">供应商与模型</span>
      <span className="px-3 py-2">性能</span>
      <span className="hidden px-3 py-2 lg:block">健康状态</span>
      <span className="px-3 py-2 text-right">状态</span>
    </TableHeaderSurface>
  )

  const renderQueueTable = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={event => void onDragEnd(event)}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="overflow-x-auto overflow-y-hidden rounded-b-lg">
          {renderTableHeader()}
          {rows.map(row => (
            <SortableQueueModel key={row.model.id} id={row.model.id}>
              {(handleProps, dragging) => (
                <QueueModelRow
                  model={row.model}
                  provider={providers[row.model.providerId]}
                  providerHealth={health[row.model.providerId]}
                  providerModelHealth={providerModelHealth[row.model.id]}
                  metrics={modelMetrics[queueModelMetricKey(row.model.providerId, row.model.id)]}
                  mode={mode}
                  selected={row.selected}
                  cooling={row.cooling}
                  dragging={dragging}
                  dragHandleProps={handleProps}
                  onSelect={() => void onSelectManualModel(row.model)}
                  onToggleEnabled={enabled => void onToggleEnabled(row.model, enabled)}
                  onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
                />
              )}
            </SortableQueueModel>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )

  const renderEmptyState = () => (
    <EmptyState
      icon={ListTree}
      title="队列中还没有模型"
      description="前往模型管理添加第一个供应商模型，回来后即可调整优先级和故障转移顺序。"
      action={onNavigateToModels && (
        <Button variant="outline" size="sm" onClick={onNavigateToModels}>
          添加供应商模型 <ArrowRight size={13} />
        </Button>
      )}
      className="min-h-48 border-0 py-10"
    />
  )

  const renderContent = () => {
    if (models.length === 0) return renderEmptyState()
    return renderQueueTable()
  }

  return (
    <Card className="overflow-hidden">
      {renderHeader()}
      <CardContent className="p-0">{renderContent()}</CardContent>
    </Card>
  )
}
