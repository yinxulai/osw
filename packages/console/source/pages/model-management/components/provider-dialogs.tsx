import type { useModelManagement } from '../hooks/use-model-management'
import { ModelDialog } from './model-dialog'
import { ProviderDialog } from './provider-dialog'
import { ProviderExportDialog } from './provider-export-dialog'
import { ProviderImportDialog } from './provider-import-dialog'

type ModelManagementService = ReturnType<typeof useModelManagement>

interface ProviderDialogsProps {
  service: ModelManagementService
}

/** 页面上的五个浮层：供应商、模型、导入、导出，以及隐藏的文件选择框。 */
export function ProviderDialogs(props: ProviderDialogsProps) {
  const { service } = props

  return (
    <>
      <ProviderDialog
        open={service.providerDialogOpen}
        onOpenChange={service.setProviderDialogOpen}
        editingProviderId={service.editingProviderId}
        providerName={service.providerName}
        apiKey={service.apiKey}
        timeout={service.timeout}
        endpointEntries={service.providerEndpointEntries}
        saving={service.saving}
        setProviderName={service.setProviderName}
        setApiKey={service.setApiKey}
        setTimeout={service.setTimeout}
        updateEndpointEntry={service.updateProviderEndpointEntry}
        onCancel={service.closeProviderDialog}
        onSave={service.saveProvider}
      />

      <ModelDialog
        open={service.modelDialogOpen}
        onOpenChange={service.setModelDialogOpen}
        editingModel={service.editingModel}
        providers={service.providers}
        providerId={service.dialogProvider?.id ?? ''}
        providerName={service.dialogProvider?.name ?? ''}
        onSelectProvider={service.selectDialogProvider}
        modelId={service.modelId}
        protocolEntries={service.protocolEntries}
        saving={service.saving}
        fetchedModels={service.fetchedModels}
        fetchingModels={service.fetchingModels}
        selectedModelIds={service.selectedModelIds}
        onFetchModels={service.fetchModels}
        setModelId={service.setModelId}
        toggleModelSelection={service.toggleModelSelection}
        selectAllFetchedModels={service.selectAllFetchedModels}
        invertFetchedModels={service.invertFetchedModels}
        clearSelectedModels={service.clearSelectedModels}
        updateProtocolEntry={service.updateProtocolEntry}
        onTestConnectivity={() => void service.testConnectivity()}
        connectivityTest={service.connectivityTest}
        onCancel={service.closeModelDialog}
        onSave={service.saveModel}
      />

      <input
        ref={service.fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) void service.prepareImport(file)
          // 重置 input，允许重复选择同一个文件
          event.target.value = ''
        }}
      />

      {service.exportScope && (
        <ProviderExportDialog
          scope={service.exportScope}
          includeApiKeys={service.includeApiKeys}
          exporting={service.exporting}
          onIncludeApiKeysChange={service.setIncludeApiKeys}
          onOpenChange={open => { if (!open) service.closeExportDialog() }}
          onConfirm={() => void service.confirmExport()}
        />
      )}

      {service.pendingImport && (
        <ProviderImportDialog
          fileName={service.pendingImport.fileName}
          bundle={service.pendingImport.bundle}
          existingProviderNames={service.providers.map(provider => provider.name)}
          importing={service.importing}
          onOpenChange={open => { if (!open) service.closeImportDialog() }}
          onConfirm={() => void service.confirmImport()}
        />
      )}
    </>
  )
}
