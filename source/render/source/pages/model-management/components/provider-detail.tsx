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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { GripVertical, Pencil, Plus, Server, Trash2, KeyRound, Timer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SortableBinding } from './sortable-binding'
import { ProviderIcon } from './provider-icon'
import { findPresetByName } from '../lib/provider-presets'
import type { Provider, UpstreamModel } from '@common/schemas'

interface ProviderDetailProps {
  provider: Provider
  models: UpstreamModel[]
  onEditProvider: () => void
  onRemoveProvider: () => void
  onAddModel: () => void
  onEditModel: (model: UpstreamModel) => void
  onRemoveModel: (model: UpstreamModel) => void
  onDragEnd: (event: DragEndEvent) => void
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { provider, models, onEditProvider, onRemoveProvider, onAddModel, onEditModel, onRemoveModel, onDragEnd } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const preset = findPresetByName(provider.name)
  const iconColor = preset?.color

  return (
    <Card>
      <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{
              color: iconColor ?? 'var(--primary)',
              backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
            }}
          >
            <ProviderIcon name={provider.name} size={17} />
          </div>
          <div>
            <CardTitle>{provider.name}</CardTitle>
            <CardDescription className="mt-1">
              凭据按供应商保存，模型沿用默认接口地址，也可单独覆盖。
            </CardDescription>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" onClick={onEditProvider}>
            <Pencil size={13} /> 编辑
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            title="删除供应商"
            onClick={onRemoveProvider}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium">上游模型</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                每个模型一行，可同时支持多个协议；拖拽调整全局队列中的相对优先级
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
              <div className="overflow-hidden rounded-lg bg-card divide-y divide-border">
                {models.map(model => (
                  <SortableBinding key={model.id} id={model.id}>
                    {(handleProps, dragging) => (
                      <div className={'flex items-center gap-2 px-3 py-2.5 ' + (dragging ? 'bg-muted/60' : '')}>
                        <button
                          aria-label={`拖动 ${model.upstreamModelId}`}
                          className="cursor-grab touch-none text-muted-foreground/50"
                          {...handleProps}
                        >
                          <GripVertical size={14} />
                        </button>
                        <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-medium text-muted-foreground">
                          {model.priority}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">{model.upstreamModelId}</span>
                            <span className="flex flex-wrap gap-1">
                              {model.endpoints.map(endpoint => (
                                <Badge key={endpoint.protocol} variant={endpoint.upstreamUrl ? 'secondary' : 'muted'} className="h-5 px-1.5 text-[9px]">
                                  {endpoint.protocol.toUpperCase()}
                                </Badge>
                              ))}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <KeyRound size={10} />
                            密钥已安全配置
                            <span className="text-muted-foreground/40">·</span>
                            <Timer size={10} />
                            超时 {provider.timeoutMilliseconds / 1000} 秒
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="编辑模型"
                          onClick={() => onEditModel(model)}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          title="删除模型"
                          onClick={() => onRemoveModel(model)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    )}
                  </SortableBinding>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex min-h-36 flex-col items-center justify-center rounded-lg bg-card text-center">
            <Server size={20} className="mb-2 text-muted-foreground/40" />
            <p className="text-xs font-medium">还没有上游模型</p>
            <p className="mt-1 text-[11px] text-muted-foreground">添加后即可通过本地代理调用</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
