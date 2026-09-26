import { useMemo } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { useModelManagement } from '@/pages/model-management/hooks/use-model-management'
import { ModelDialog } from '@/pages/model-management/components/model-dialog'
import { ProviderDialog } from '@/pages/model-management/components/provider-dialog'
import { ProviderPresetPicker } from '@/pages/model-management/components/provider-preset-picker'

/**
 * 第二步：添加模型。
 *
 * 数据模型决定了「模型」必须挂在供应商下（`ProviderModel.providerId`），所以这一步实际是
 * **供应商 + 模型一起配**：先选个预设把地址填好、填 Key 建供应商，再从该供应商拉取模型并勾选。
 *
 * 复用整条模型管理链路（`useModelManagement` + 两个对话框组件），不重写一套「引导版」表单：
 * 拉取失败、重复模型、协议端点、转换开关这些分支在正式页面里已经被打磨过，
 * 引导页要的只是同一套交互的一个入口，另写一份等于把那些分支再赌一次。
 *
 * 文案刻意只有**一处**：`ProviderPresetPicker` 自带「快速选择」标签，控件本身说明了它是干什么的；
 * 页头那句描述说清了整条路径（选预设 → 填 Key → 拉取勾选）。所以这里不再叠第二段操作说明，
 * 而是把话留给**卡住的那个位置** —— 列表在两种状态下各给一句下一步：
 * 一个供应商都没有时说「先选上面那个预设」，有供应商但还没模型时说「点添加模型去拉」。
 * 用户真正会停下来的地方是后者，而不是开头。
 */
export function AddModelStep() {
  const service = useModelManagement()
  const t = useTranslation()

  // 每个供应商下已有几个模型：列表要显示「这家接了几个」，但不必展开模型明细。
  const modelCountByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of service.models) {
      counts.set(model.providerId, (counts.get(model.providerId) ?? 0) + 1)
    }
    return counts
  }, [service.models])

  const hasProviders = service.providers.length > 0

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <ProviderPresetPicker providerName={service.providerName} onApplyPreset={service.openPresetDialog} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void service.openProviderDialog()}>
            <Plus />
            {t('onboarding.models.customProvider')}
          </Button>
          <Button
            size="sm"
            disabled={!service.selectedProvider}
            onClick={() => service.openModelDialog()}
          >
            <Plus />
            {t('onboarding.models.addModel')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="system-xs-medium text-text-secondary">{t('onboarding.models.connectedTitle')}</p>
        {hasProviders ? (
          <div className="space-y-2">
            <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-module-border">
              {service.providers.map(provider => (
                <li key={provider.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">{provider.name}</span>
                  <span className="shrink-0 system-xs-regular text-text-tertiary">
                    {t('onboarding.models.modelCount', { count: modelCountByProvider.get(provider.id) ?? 0 })}
                  </span>
                </li>
              ))}
            </ul>
            {/* 有供应商、没模型——这一步最常见的停点：列表里每条都是「0 个模型」，
                而上一颗按钮为什么该按（以及按下去要干什么）只在这里说一次。 */}
            {service.models.length === 0 && (
              <p className="system-xs-regular text-text-tertiary">{t('onboarding.models.nextAddModel')}</p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-module-border px-3 py-6 text-center system-xs-regular text-text-tertiary">
            {t('onboarding.models.empty')}
          </p>
        )}
      </div>

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
        selectAllFetchedModels={service.selectAllFetchedModels}
        invertFetchedModels={service.invertFetchedModels}
        clearSelectedModels={service.clearSelectedModels}
        updateProtocolEntry={service.updateProtocolEntry}
        onCancel={service.closeModelDialog}
        onSave={service.saveModel}
      />
    </div>
  )
}
