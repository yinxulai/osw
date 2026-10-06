import { useState } from 'react'
import { Download, FlaskConical, Plus, Upload, MousePointerClick } from 'lucide-react'
import { ModelTestPanel } from '@/components/model-test-panel'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n/provider'
import { useModelManagementService } from './service'
import { ProviderGrid } from './components/provider-grid'
import { ProviderDetail } from './components/provider-detail'
import { ProviderDialog } from './components/provider-dialog'
import { ModelDialog } from './components/model-dialog'
import { ProviderExportDialog } from './components/provider-export-dialog'
import { ProviderImportDialog } from './components/provider-import-dialog'

export function ModelManagementPage() {
  const service = useModelManagementService()
  const t = useTranslation()
  const [testPanelOpen, setTestPanelOpen] = useState(false)

  const renderHeaderActions = () => (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={service.openImportFilePicker}>
        <Upload size={14} /> {t('providers.action.import')}
      </Button>
      <Button
        variant="outline"
        disabled={service.providers.length === 0}
        onClick={() => service.openExportDialog({ kind: 'all' })}
      >
        <Download size={14} /> {t('providers.action.exportAll')}
      </Button>
      <Button variant="outline" onClick={() => setTestPanelOpen(true)}>
        <FlaskConical size={14} /> {t('providers.action.connectionTest')}
      </Button>
      <Button onClick={() => service.openProviderDialog()}>
        <Plus size={14} /> {t('providers.action.create')}
      </Button>
    </div>
  )

  const renderImportFileInput = () => (
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
  )

  const renderLoading = () => (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="p-3">
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-sm" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )

  const renderProviderSelection = () => {
    if (service.selectedProvider) {
      return (
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
      )
    }

    return (
      <Card>
        <EmptyState
          icon={MousePointerClick}
          title={service.providers.length > 0 ? t('providers.empty.selectTitle') : t('providers.empty.noneTitle')}
          description={
            service.providers.length > 0
              ? t('providers.empty.selectDescription')
              : t('providers.empty.noneDescription')
          }
          action={
            service.providers.length === 0 ? (
              <Button size="default" onClick={() => service.openProviderDialog()}>
                <Plus size={14} /> {t('providers.action.create')}
              </Button>
            ) : undefined
          }
          className="min-h-64"
        />
      </Card>
    )
  }

  const renderProviderWorkspace = () => (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ProviderGrid
        providers={service.providers}
        models={service.models}
        selectedProviderId={service.selectedProviderId}
        onSelectProvider={service.setSelectedProviderId}
        onSelectBuiltInProvider={service.openPresetDialog}
        onReorderProviders={service.reorderProviders}
      />
      {renderProviderSelection()}
    </div>
  )

  const renderBody = () => {
    if (service.loading) return renderLoading()
    return renderProviderWorkspace()
  }

  const renderDialogs = () => (
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
        onCancel={service.closeModelDialog}
        onSave={service.saveModel}
      />

      <ModelTestPanel
        open={testPanelOpen}
        onOpenChange={setTestPanelOpen}
        models={service.models}
        providers={service.providers}
      />

      {renderImportFileInput()}

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

  return (
    <PageLayout>
      <PageHeader title={t('providers.title')} description={t('providers.description')} actions={renderHeaderActions()} />
      <PageContent>
        {renderBody()}
        {renderDialogs()}
      </PageContent>
    </PageLayout>
  )
}
