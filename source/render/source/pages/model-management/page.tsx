import { useState } from 'react'
import { FlaskConical, Plus, MousePointerClick } from 'lucide-react'
import { ModelTestPanel } from '@/components/model-test-panel'
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
  const [testPanelOpen, setTestPanelOpen] = useState(false)

  const renderHeaderActions = () => (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => setTestPanelOpen(true)}>
        <FlaskConical size={14} /> 连接测试
      </Button>
      <Button onClick={() => service.openProviderDialog()}>
        <Plus size={14} /> 新建供应商
      </Button>
    </div>
  )

  const renderLoading = () => (
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
  )

  const renderProviderSelection = () => {
    if (service.selectedProvider) {
      return (
        <ProviderDetail
          provider={service.selectedProvider}
          models={service.selectedModels}
          onToggleProviderEnabled={enabled => void service.updateProviderEnabled(service.selectedProvider!, enabled)}
          onEditProvider={() => service.openProviderDialog(service.selectedProvider)}
          onRemoveProvider={() => service.removeProvider(service.selectedProvider!)}
          onAddModel={() => service.openModelDialog()}
          onEditModel={service.openModelDialog}
          onToggleModelEnabled={service.updateModelEnabled}
          onRemoveModel={service.removeModel}
          onDragEnd={service.handleDragEnd}
        />
      )
    }

    return (
      <Card>
        <EmptyState
          icon={MousePointerClick}
          title={service.providers.length > 0 ? '选择一个供应商查看详情' : '还没有供应商'}
          description={
            service.providers.length > 0
              ? '从左侧列表中选择一个供应商，即可查看和管理其供应商模型与协议地址。'
              : '创建供应商并配置凭据后，即可添加供应商模型与协议地址。'
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
        providerName={service.selectedProvider?.name ?? ''}
        modelId={service.modelId}
        protocolEntries={service.protocolEntries}
        saving={service.saving}
        fetchedModels={service.fetchedModels}
        fetchingModels={service.fetchingModels}
        selectedModelIds={service.selectedModelIds}
        onFetchModels={service.fetchModels}
        setModelId={service.setModelId}
        toggleModelSelection={service.toggleModelSelection}
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
    </>
  )

  return (
    <PageLayout>
      <PageHeader title="模型管理" description="集中管理供应商凭据与供应商模型映射" actions={renderHeaderActions()} />
      <PageContent>
        {renderBody()}
        {renderDialogs()}
      </PageContent>
    </PageLayout>
  )
}
