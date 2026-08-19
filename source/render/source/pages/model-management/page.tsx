import { Plus, MousePointerClick } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
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
          <Button size="default" onClick={() => service.openProviderDialog()}>
            <Plus size={14} /> 新建供应商
          </Button>
        }
      />
      <PageContent>
        {service.loading ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="min-w-45 p-3">
                  <Skeleton className="mb-2 h-4 w-20" />
                  <Skeleton className="h-3 w-16" />
                </Card>
              ))}
            </div>
            <Card className="p-4">
              <Skeleton className="mb-4 h-5 w-32" />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
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
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <ProviderGrid
                providers={service.providers}
                models={service.models}
                health={service.health}
                selectedProviderId={service.selectedProviderId}
                onSelect={service.setSelectedProviderId}
              />

              {service.selectedProvider ? (
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
              ) : (
                <Card>
                  <EmptyState
                    icon={MousePointerClick}
                    title={service.providers.length > 0 ? '选择一个供应商查看详情' : '还没有供应商'}
                    description={
                      service.providers.length > 0
                        ? '从左侧列表中选择一个供应商，即可查看和管理其上游模型、协议地址与健康状态。'
                        : '创建供应商并配置凭据后，即可添加上游模型与协议地址。'
                    }
                    action={
                      service.providers.length === 0 ? (
                        <Button size="default" onClick={() => service.openProviderDialog()}>
                          <Plus size={14} /> 新建供应商
                        </Button>
                      ) : undefined
                    }
                    className="min-h-64"
                  />
                </Card>
              )}
            </div>
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
