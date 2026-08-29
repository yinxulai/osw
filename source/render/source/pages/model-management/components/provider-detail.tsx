import type { DragEndEvent } from '@dnd-kit/core'
import { Card, CardContent } from '@/components/ui/card'
import { ProviderDetailHeader } from './provider-detail-header'
import { ProviderModelList } from './provider-model-list'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderDetailProps {
  provider: Provider
  models: ProviderModelRoute[]
  onToggleProviderEnabled: (enabled: boolean) => void
  onEditProvider: () => void
  onRemoveProvider: () => void
  onAddModel: () => void
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
  onRemoveModels: (models: ProviderModelRoute[]) => Promise<boolean>
  onDisableModels: (models: ProviderModelRoute[]) => Promise<boolean>
  onDragEnd: (event: DragEndEvent) => void
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { provider, models, onToggleProviderEnabled, onEditProvider, onRemoveProvider, onAddModel, onEditModel, onToggleModelEnabled, onRemoveModel, onRemoveModels, onDisableModels, onDragEnd } = props

  return (
    <Card>
      <ProviderDetailHeader
        provider={provider}
        onToggleProviderEnabled={onToggleProviderEnabled}
        onEditProvider={onEditProvider}
        onRemoveProvider={onRemoveProvider}
      />
      <CardContent className="pt-0">
        <ProviderModelList
          provider={provider}
          models={models}
          onAddModel={onAddModel}
          onEditModel={onEditModel}
          onToggleModelEnabled={onToggleModelEnabled}
          onRemoveModel={onRemoveModel}
          onRemoveModels={onRemoveModels}
          onDisableModels={onDisableModels}
          onDragEnd={onDragEnd}
        />
      </CardContent>
    </Card>
  )
}
