import type { useModelManagement } from '../hooks/use-model-management'
import { ProviderGrid } from './provider-grid'
import { ProviderDetail } from './provider-detail'
import { ProviderSelectionEmpty } from './provider-selection-empty'

type ModelManagementService = ReturnType<typeof useModelManagement>

interface ProviderWorkspaceProps {
  service: ModelManagementService
}

/** 左右两栏：供应商列表 + 当前供应商详情。窄屏自动堆叠。 */
export function ProviderWorkspace(props: ProviderWorkspaceProps) {
  const { service } = props

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <ProviderGrid
          providers={service.providers}
          models={service.models}
          selectedProviderId={service.selectedProviderId}
          onSelectProvider={service.setSelectedProviderId}
          onSelectBuiltInProvider={service.openPresetDialog}
          onReorderProviders={service.reorderProviders}
        />
      </div>
      <div className="min-w-0">
        {service.selectedProvider ? (
          <ProviderDetail
            provider={service.selectedProvider}
            models={service.selectedModels}
            onToggleProviderEnabled={enabled => void service.updateProviderEnabled(service.selectedProvider!, enabled)}
            onEditProvider={() => service.openProviderDialog(service.selectedProvider)}
            onExportProvider={() => service.openExportDialog({ kind: 'provider', provider: service.selectedProvider! })}
            onRemoveProvider={() => service.removeProvider(service.selectedProvider!)}
            onAddModel={() => service.openModelDialog()}
            onEditModel={service.openModelDialog}
            onToggleModelEnabled={service.updateModelEnabled}
            onRemoveModel={service.removeModel}
            onRemoveModels={service.removeModels}
            onDisableModels={service.disableModels}
          />
        ) : (
          <ProviderSelectionEmpty
            hasProviders={service.providers.length > 0}
            onCreate={() => service.openProviderDialog()}
          />
        )}
      </div>
    </div>
  )
}
