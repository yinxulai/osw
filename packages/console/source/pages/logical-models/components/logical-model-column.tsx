import { useState } from 'react'
import type { LogicalModel, LogicalModelProviderModel } from '@common/schemas'
import { isBuiltInDefaultLogicalModel } from '@common/schemas'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useLogicalModelControlService } from '../service'
import { LogicalModelCard } from './logical-model-card'
import { AddProviderModelDialog } from './add-provider-model-dialog'
import { EditLogicalModelDialog } from './edit-logical-model-dialog'
import { removeLogicalModel, removeProviderModelBinding } from '../lib/logical-model-writes'

interface LogicalModelColumnProps {
  logicalModel: LogicalModel
  dragHandleProps?: Record<string, unknown>
  dragging?: boolean
  /** 每个供应商模型此刻在途的请求数；只影响行内状态徽标，不参与排序或调度。 */
  processingCounts: Map<string, number>
  /** 改 id / 改说明 / 删除之后刷新逻辑模型列表（列表变了，卡片才会跟着走）。 */
  onChanged: () => void
}

/** 瀑布流里的一列：一张逻辑模型卡 + 它自己的两个对话框。 */
export function LogicalModelColumn(props: LogicalModelColumnProps) {
  const { logicalModel, dragHandleProps, dragging, processingCounts, onChanged } = props
  // 两把钥匙一整个交下去：绑定接口用记录 id，展示与手动锁定用模型 id。
  const service = useLogicalModelControlService(logicalModel)
  const confirm = useConfirm()
  const toast = useToast()
  const t = useTranslation()
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const builtIn = isBuiltInDefaultLogicalModel(logicalModel)

  const removeModel = async (model: LogicalModelProviderModel) => {
    const confirmed = await confirm({
      title: t('logicalModels.remove.title'),
      description: t('logicalModels.remove.description', { id: logicalModel.modelId, model: model.modelName }),
      confirmLabel: t('logicalModels.remove.confirm'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await removeProviderModelBinding(logicalModel.id, model.id)
      await service.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('logicalModels.remove.failed'))
    }
  }

  // 删除是软删除（服务端只打时间戳），所以界面这一侧只需要把列表刷掉：卡片不在列表里就不再出现。
  const deleteLogicalModel = async () => {
    const confirmed = await confirm({
      title: t('logicalModels.delete.title'),
      description: t('logicalModels.delete.description', { id: logicalModel.modelId }),
      confirmLabel: t('logicalModels.delete.confirm'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await removeLogicalModel(logicalModel.id)
      toast.success(t('logicalModels.delete.deleted'))
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <LogicalModelCard
        modelId={logicalModel.modelId}
        logicalModelDescription={logicalModel.description}
        builtIn={builtIn}
        models={service.models}
        providers={service.providers}
        health={service.health}
        providerModelHealth={service.providerModelHealth}
        modelMetrics={service.modelMetrics}
        mode={service.mode}
        manualModelId={service.manualModelId ?? ''}
        switchingMode={service.switchingMode}
        isCooling={service.isCooling}
        onModeChange={mode => void service.changeMode(mode)}
        onSelectManualModel={service.selectManualModel}
        onToggleEnabled={service.updateEnabled}
        onDragEnd={service.handleDragEnd}
        onAddModel={() => setAddModelOpen(true)}
        onRemoveModel={model => void removeModel(model)}
        onEdit={() => setEditOpen(true)}
        // 内建默认不给删除入口：它是未命中任何逻辑模型时的落点，删掉就没有兜底了。
        onDelete={builtIn ? undefined : () => void deleteLogicalModel()}
        dragHandleProps={dragHandleProps}
        dragging={dragging}
        processingCounts={processingCounts}
      />
      <AddProviderModelDialog
        open={addModelOpen}
        logicalModelRecordId={logicalModel.id}
        existingBindingCount={service.models.length}
        onOpenChange={setAddModelOpen}
        onAdded={() => void service.reload()}
      />
      <EditLogicalModelDialog
        logicalModel={logicalModel}
        builtIn={builtIn}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onChanged}
      />
    </>
  )
}
