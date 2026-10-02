import { useMemo } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { useModelManagement } from '@/pages/model-management/hooks/use-model-management'
import { ModelDialog } from '@/pages/model-management/components/model-dialog'
import { ProviderDialog } from '@/pages/model-management/components/provider-dialog'
import { ProviderIcon } from '@/pages/model-management/components/provider-icon'
import { PROVIDER_PRESETS, type ProviderPreset } from '@/pages/model-management/lib/provider-presets'

interface ProviderCardGridProps {
  onSelectCustom: () => void
  onSelectPreset: (preset: ProviderPreset) => void
}

/**
 * 供应商宫格：首位「自定义供应商」，其余是内置预设，等大卡片平铺。
 * 「新建一个供应商」在这里就是一个动作一张卡——没有菜单可点开，命中预设直接带地址进对话框，
 * 选「自定义」就从零填。空态与「已接入」态共用同一张宫格，风格、尺寸保持一致。
 */
function ProviderCardGrid(props: ProviderCardGridProps) {
  const t = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <button
        type="button"
        onClick={props.onSelectCustom}
        className={cn(
          'flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-module-border px-3 text-center transition-colors',
          'hover:border-primary/40 hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        )}
      >
        <Plus className="size-5 text-text-tertiary" aria-hidden />
        <span className="truncate system-xs-medium text-text-secondary">{t('onboarding.models.customProvider')}</span>
      </button>

      {PROVIDER_PRESETS.map(preset => (
        <button
          key={preset.key}
          type="button"
          onClick={() => props.onSelectPreset(preset)}
          className={cn(
            'flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-module-border px-3 text-center transition-colors',
            'hover:border-primary/40 hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          )}
        >
          <span style={{ color: preset.color }}>
            <ProviderIcon name={preset.name} size={22} />
          </span>
          <span className="w-full truncate system-xs-medium text-text-primary">{preset.name}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 第一步：添加供应商与模型。
 *
 * 数据模型决定了「模型」必须挂在供应商下（`ProviderModel.providerId`），所以这一步实际是
 * **供应商 + 模型一起配**。复用整条模型管理链路（`useModelManagement` + 两个对话框组件），
 * 不重写一套「引导版」表单：拉取失败、重复模型、协议端点、转换开关这些分支在正式页面里
 * 已经被打磨过，引导页要的只是同一套交互的一个入口，另写一份等于把那些分支再赌一次。
 *
 * 版面刻意是**一张供应商表**，而不是「添加供应商」「添加模型」两颗并列的顶层按钮：
 * 后者把「先建谁、再给谁加模型」这层归属藏进了两段独立流程，用户点「添加模型」时根本不知道
 * 会加到哪一家（原来的实现只能加到侧栏选中的那一个，而在引导页里这个「选中」是隐式的）。
 * 改成每行一个供应商、行尾就地「添加模型」，归属写在脸上：模型加给哪一家，就点哪一行。
 *
 * 添加新供应商则退到表格下方，和空态共用**同一张宫格卡片墙**（首位「自定义供应商」+ 内置预设），
 * 而不是一颗孤立的通栏按钮——两种状态下的「新建供应商」长得一模一样，也都是一卡一动作。
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
      <div className="space-y-2">
        {hasProviders ? (
          <>
            <p className="system-xs-medium text-text-secondary">{t('onboarding.models.connectedTitle')}</p>

            <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-module-border">
              {service.providers.map(provider => (
                <li key={provider.id} className="flex items-center gap-3 px-3 py-2">
                  <ProviderIcon name={provider.name} size={18} />
                  <span className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">{provider.name}</span>
                  <span className="shrink-0 system-xs-regular text-text-tertiary">
                    {t('onboarding.models.modelCount', { count: modelCountByProvider.get(provider.id) ?? 0 })}
                  </span>
                  {/* 模型加给哪一家，就是点哪一行——归属由位置表达，不再依赖一个隐式的「当前供应商」。 */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => service.openModelDialog(undefined, provider.id)}
                  >
                    <Plus />
                    {t('onboarding.models.addModel')}
                  </Button>
                </li>
              ))}
            </ul>

            {/* 新建供应商和空态共用同一张宫格：一卡一动作，风格与尺寸完全一致。 */}
            <p className="system-xs-medium text-text-secondary">{t('onboarding.models.addProvider')}</p>
            <ProviderCardGrid
              onSelectCustom={() => void service.openProviderDialog()}
              onSelectPreset={service.openPresetDialog}
            />
          </>
        ) : (
          // 一个供应商都没有：预设摊成一整面等大的卡片，第一张是「自定义供应商」——
          // 让「自己有家的供应商」这条真正常见的路径站在第一位，而不是缩在菜单底部。
          <>
            <p className="system-xs-regular text-text-tertiary">{t('onboarding.models.empty')}</p>
            <ProviderCardGrid
              onSelectCustom={() => void service.openProviderDialog()}
              onSelectPreset={service.openPresetDialog}
            />
          </>
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
    </div>
  )
}
