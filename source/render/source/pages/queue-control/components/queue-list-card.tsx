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
import { Circle, CircleDot, GripVertical, RefreshCw, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { SortableBinding } from './sortable-binding'
import type { UpstreamModel, Provider } from '@common/schemas'

export type ProviderMap = Record<string, Provider>

interface QueueListCardProps {
  models: UpstreamModel[]
  providers: ProviderMap
  logicalModelName?: string
  mode: 'auto' | 'manual'
  manualModelId: string
  isCooling: (providerId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: UpstreamModel) => void
  onToggleEnabled: (model: UpstreamModel, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
}

export function QueueListCard(props: QueueListCardProps) {
  const {
    models,
    providers,
    logicalModelName,
    mode,
    manualModelId,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
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
            逻辑模型 {logicalModelName ?? '尚未配置'}，拖拽后立即保存
          </CardDescription>
        </div>
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
              <div className="-mx-4 divide-y border-t">
                {models.map(model => {
                  const provider = providers[model.providerId]
                  const cooling = isCooling(model.providerId)
                  const selected = mode === 'manual' && manualModelId === model.id
                  const endpointUrls = model.endpoints
                    .map(endpoint => endpoint.upstreamUrl.trim())
                    .filter(Boolean)
                  return (
                    <SortableBinding key={model.id} id={model.id}>
                      {(handleProps, dragging) => (
                        <div
                          onClick={() => void onSelectManualModel(model)}
                          className={cn(
                            'flex items-center gap-2 border-l-2 border-l-transparent px-4 py-2.5',
                            selected && 'border-l-primary bg-primary/5',
                            mode === 'manual' && model.enabled && !cooling && 'cursor-pointer hover:bg-muted/40',
                            dragging && 'bg-muted/60',
                          )}
                        >
                          {mode === 'manual' ? (
                            selected ? (
                              <CircleDot size={16} className="text-primary" />
                            ) : (
                              <Circle size={16} className="text-muted-foreground/40" />
                            )
                          ) : (
                            <button
                              aria-label={`拖动 ${model.upstreamModelId}`}
                              className="cursor-grab touch-none text-muted-foreground/50"
                              {...handleProps}
                            >
                              <GripVertical size={14} />
                            </button>
                          )}
                          <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
                            {model.priority}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold">
                                {provider?.name ?? '未知供应商'}
                              </span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {model.upstreamModelId}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {model.endpoints.map(endpoint => (
                                <Badge key={endpoint.protocol} variant="outline" className="h-4 px-1 text-[9px]">
                                  {endpoint.protocol.toUpperCase()}
                                </Badge>
                              ))}
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {endpointUrls.join(' / ')}
                              </span>
                            </div>
                          </div>
                          <Badge variant={cooling ? 'destructive' : model.enabled ? 'success' : 'muted'}>
                            {cooling ? '冷却中' : model.enabled ? (selected ? '当前指定' : '待命') : '已禁用'}
                          </Badge>
                          <Switch
                            checked={model.enabled}
                            onCheckedChange={enabled => void onToggleEnabled(model, enabled)}
                            onClick={event => event.stopPropagation()}
                            aria-label={`${model.upstreamModelId} 启用状态`}
                          />
                        </div>
                      )}
                    </SortableBinding>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex min-h-40 items-center justify-center border-t text-xs text-muted-foreground">
            请先在模型管理中添加上游模型。
          </div>
        )}
      </CardContent>
    </Card>
  )
}
