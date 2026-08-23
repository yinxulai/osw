import { GripVertical, KeyRound, Pencil, Timer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProviderRuleBindings } from './provider-rule-bindings'
import { Switch } from '@/components/ui/switch'
import { ProtocolIcons } from '@/components/protocol-icons'
import { SortableProviderModel } from './sortable-provider-model'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderModelRowProps {
  provider: Provider
  model: ProviderModelRoute
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
}

export function ProviderModelRow(props: ProviderModelRowProps) {
  const { provider, model, onEditModel, onToggleModelEnabled, onRemoveModel } = props

  return (
    <SortableProviderModel id={model.id}>
      {(handleProps, dragging) => (
        <div className={'px-3 py-2.5 ' + (dragging ? 'bg-muted/60' : '')}>
          <div className="flex items-center gap-2">
          <button
            aria-label={`拖动 ${model.modelName}`}
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
              <span className="truncate text-xs font-medium">{model.modelName}</span>
              <ProtocolIcons endpoints={model.endpoints} />
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <KeyRound size={10} />
              密钥已安全配置
              <span className="text-muted-foreground/70">·</span>
              <Timer size={10} />
              超时 {provider.timeoutMilliseconds / 1000} 秒
            </div>
          </div>
          <Switch
            checked={model.enabled}
            onCheckedChange={enabled => onToggleModelEnabled(model, enabled)}
            aria-label={`${model.modelName} 启用状态`}
          />
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
          <ProviderRuleBindings providerModelId={model.id} />
        </div>
      )}
    </SortableProviderModel>
  )
}
