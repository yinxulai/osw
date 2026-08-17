import { Plus } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useModelManagementService } from './service'
import { ProviderGrid } from './components/provider-grid'
import { ProviderDetail } from './components/provider-detail'
import { ProviderDialog } from './components/provider-dialog'
import { ModelDialog } from './components/model-dialog'

export function ModelManagementPage() {
  const service = useModelManagementService()

  return (
    <PageLayout>
      <PageHeader
        title="模型管理"
        description="集中管理供应商凭据与上游模型映射"
        actions={
          <Button size="sm" className="h-8 text-xs" onClick={() => service.openProviderDialog()}>
            <Plus size={14} /> 新建供应商
          </Button>
        }
      />
      <PageContent>
        {service.errorMessage && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {service.errorMessage}
          </div>
        )}
        {service.loading ? (
          <Card className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">
            正在加载模型配置...
          </Card>
        ) : (
          <>
            <ProviderGrid
              providers={service.providers}
              models={service.models}
              health={service.health}
              selectedProviderId={service.selectedProviderId}
              onSelect={service.setSelectedProviderId}
            />

            {service.selectedProvider && (
              <ProviderDetail
                provider={service.selectedProvider}
                models={service.selectedModels}
                health={service.health}
                onEditProvider={() => service.openProviderDialog(service.selectedProvider)}
                onRemoveProvider={() => service.removeProvider(service.selectedProvider!)}
                onAddModel={() => service.openModelDialog()}
                onEditModel={service.openModelDialog}
                onRemoveModel={service.removeModel}
                onDragEnd={service.handleDragEnd}
              />
            )}
          </>
        )}

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
          providerName={service.selectedProvider?.name ?? ''}
          modelId={service.modelId}
          bindingEntries={service.bindingEntries}
          saving={service.saving}
          setModelId={service.setModelId}
          updateBindingEntry={service.updateBindingEntry}
          onCancel={service.closeModelDialog}
          onSave={service.saveModel}
        />
      </PageContent>
    </PageLayout>
  )
}
