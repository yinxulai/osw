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
import { useMemo, useState } from 'react'
import { TableHeaderSurface } from '@/components/table-primitives'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SortableQueueModel } from './sortable-queue-model'
import { SortableQueueGroup } from './sortable-queue-group'
import { QueueModelRow } from './queue-model-row'
import { QueueGroupHeader } from './queue-group-header'
import { buildQueueUnits } from '../lib/queue-groups'
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
  // 分组默认收起：仅记录"已展开"的分组 id
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const units = useMemo(() => buildQueueUnits(models, providers), [models, providers])
  const sortableIds = useMemo(() => units.map(unit => unit.id), [units])
  const groupCount = units.filter(unit => unit.kind === 'group').length

  const toggleGroupCollapsed = (groupId: string) => {
    setExpandedGroups(current => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const rows = models.map(model => ({
    model,
    cooling: isCooling(model.providerId, model.id),
    selected: mode === 'manual' && manualModelId === model.id,
  }))
  const rowByModelId = new Map(rows.map(row => [row.model.id, row]))
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
          {groupCount > 0 && <span> · {groupCount} 个免费模型分组</span>}
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

  const renderModelRow = (model: ProviderModelRoute, inGroup: boolean) => {
    const row = rowByModelId.get(model.id)
    if (!row) return null
    return (
      <QueueModelRow
        model={row.model}
        provider={providers[row.model.providerId]}
        providerHealth={health[row.model.providerId]}
        providerModelHealth={providerModelHealth[row.model.id]}
        metrics={modelMetrics[queueModelMetricKey(row.model.providerId, row.model.id)]}
        mode={mode}
        selected={row.selected}
        cooling={row.cooling}
        dragging={false}
        dragHandleProps={{}}
        inGroup={inGroup}
        onSelect={() => void onSelectManualModel(row.model)}
        onToggleEnabled={enabled => void onToggleEnabled(row.model, enabled)}
        onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
      />
    )
  }

  const renderQueueTable = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={event => void onDragEnd(event)}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="overflow-x-auto overflow-y-hidden rounded-b-lg">
          {renderTableHeader()}
          {units.map(unit => {
            if (unit.kind === 'model') {
              return (
                <SortableQueueModel key={unit.id} id={unit.id}>
                  {(handleProps, dragging) => (
                    <QueueModelRow
                      model={unit.model}
                      provider={providers[unit.model.providerId]}
                      providerHealth={health[unit.model.providerId]}
                      providerModelHealth={providerModelHealth[unit.model.id]}
                      metrics={modelMetrics[queueModelMetricKey(unit.model.providerId, unit.model.id)]}
                      mode={mode}
                      selected={rowByModelId.get(unit.id)?.selected ?? false}
                      cooling={rowByModelId.get(unit.id)?.cooling ?? false}
                      dragging={dragging}
                      dragHandleProps={handleProps}
                      onSelect={() => void onSelectManualModel(unit.model)}
                      onToggleEnabled={enabled => void onToggleEnabled(unit.model, enabled)}
                      onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
                    />
                  )}
                </SortableQueueModel>
              )
            }

            const collapsed = !expandedGroups.has(unit.id)
            return (
              <SortableQueueGroup key={unit.id} id={unit.id}>
                {(handleProps, dragging) => (
                  <div>
                    <QueueGroupHeader
                      providerName={unit.providerName}
                      models={unit.models}
                      collapsed={collapsed}
                      mode={mode}
                      dragging={dragging}
                      dragHandleProps={handleProps}
                      onToggleCollapsed={() => toggleGroupCollapsed(unit.id)}
                    />
                    {!collapsed && unit.models.map(groupModel => (
                      <div key={groupModel.id}>{renderModelRow(groupModel, true)}</div>
                    ))}
                  </div>
                )}
              </SortableQueueGroup>
            )
          })}
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
