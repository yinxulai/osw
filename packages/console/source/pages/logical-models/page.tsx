import { Boxes, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { isBuiltInDefaultLogicalModel } from '@common/schemas'
import { providerModelProcessingCounts } from '@common/provider-model-status'
import { AsyncState } from '@/components/async-state'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { MasonryGrid, masonryCollisionDetection, masonrySortingStrategy } from '@/components/masonry-grid'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useLiveRequests } from '@/data/live-requests'
import { useLogicalModels, useLogicalModelsActions, useLogicalModelsError, useLogicalModelsLoading } from '@/data/logical-models'
import { useTranslation } from '@/i18n/provider'
import { useLogicalModelControlService } from './service'
import { CreateLogicalModelDialog } from './components/create-logical-model-dialog'
import { LogicalModelColumn } from './components/logical-model-column'
import { LogicalModelSummary } from './components/logical-model-summary'
import { LogicalModelsSkeleton } from './components/logical-models-skeleton'
import { SortableLogicalModel } from './components/sortable-logical-model'

export function LogicalModelsPage() {
  const toast = useToast()
  const logicalModels = useLogicalModels()
  const logicalModelsLoading = useLogicalModelsLoading()
  const logicalModelsError = useLogicalModelsError()
  const liveRequests = useLiveRequests()
  const { refresh: refreshLogicalModels, reorder: reorderLogicalModels } = useLogicalModelsActions()
  // 页头代理开关与顶部指标卡都挂在**内建默认逻辑模型**上：它是请求未命中任何逻辑模型时的
  // 落点，也是这一页唯一一个跨全部逻辑模型的全局口径。列表没回来时传 `null`，控制服务里
  // 的查询一个都不开火，所以骨架屏只能由列表自身的就绪状态决定——挂在控制服务上会永远等下去。
  const defaultLogicalModel = useMemo(() => logicalModels.find(isBuiltInDefaultLogicalModel) ?? null, [logicalModels])
  const service = useLogicalModelControlService(defaultLogicalModel)
  const t = useTranslation()
  const [createLogicalModelOpen, setCreateLogicalModelOpen] = useState(false)
  const proxyRunning = service.proxyStatus?.running ?? false
  const enabledLogicalModels = logicalModels.filter(model => model.enabled)
  const processingCounts = useMemo(() => providerModelProcessingCounts(liveRequests.data), [liveRequests.data])
  const enabledIds = useMemo(() => enabledLogicalModels.map(model => model.id), [enabledLogicalModels])
  const hasModels = logicalModels.length > 0

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleReorder = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = logicalModels.findIndex(model => model.id === active.id)
    const newIndex = logicalModels.findIndex(model => model.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(logicalModels, oldIndex, newIndex)
    try {
      await reorderLogicalModels(reordered.map(model => model.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [logicalModels, reorderLogicalModels, toast])

  const emptyState = hasModels
    ? {
        icon: Boxes,
        title: t('logicalModels.empty.disabledTitle'),
        description: t('logicalModels.empty.disabledDescription'),
      }
    : {
        icon: Boxes,
        title: t('logicalModels.empty.title'),
        description: t('logicalModels.empty.description'),
      }

  return (
    <PageLayout>
      <PageHeader
        title={t('logicalModels.title')}
        description={t('logicalModels.description')}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setCreateLogicalModelOpen(true)}>
              <Plus size={13} /> {t('logicalModels.create.open')}
            </Button>
            <ProxyToggleButton running={proxyRunning} onToggle={service.toggleProxy} />
          </div>
        )}
      />
      <PageContent>
        <AsyncState
          loading={logicalModelsLoading}
          error={hasModels ? null : logicalModelsError}
          errorTitle={t('logicalModels.loadFailed')}
          onRetry={refreshLogicalModels}
          empty={!hasModels || enabledLogicalModels.length === 0}
          emptyState={{
            ...emptyState,
            action: (
              <Button onClick={() => setCreateLogicalModelOpen(true)}>
                <Plus size={14} />
                {t('logicalModels.create.open')}
              </Button>
            ),
          }}
          loadingFallback={<LogicalModelsSkeleton />}
        >
          <LogicalModelSummary models={service.models} summaryMetrics={service.summaryMetrics} />

          <DndContext
            sensors={sensors}
            collisionDetection={masonryCollisionDetection}
            modifiers={[restrictToWindowEdges]}
            onDragEnd={event => void handleReorder(event)}
          >
            {/* 瀑布流里卡片高度不等，用 masonrySortingStrategy，避免拖动时卡片被纵向压扁。 */}
            <SortableContext items={enabledIds} strategy={masonrySortingStrategy}>
              <MasonryGrid
                items={enabledLogicalModels.map(model => ({
                  id: model.id,
                  node: (
                    <SortableLogicalModel id={model.id}>
                      {(handleProps, dragging) => (
                        <LogicalModelColumn
                          logicalModel={model}
                          dragHandleProps={handleProps}
                          dragging={dragging}
                          processingCounts={processingCounts}
                          onChanged={refreshLogicalModels}
                        />
                      )}
                    </SortableLogicalModel>
                  ),
                }))}
              />
            </SortableContext>
          </DndContext>
        </AsyncState>

        <CreateLogicalModelDialog
          open={createLogicalModelOpen}
          onOpenChange={setCreateLogicalModelOpen}
          onCreated={refreshLogicalModels}
        />
      </PageContent>
    </PageLayout>
  )
}
