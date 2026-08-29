import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { FetchedModelPicker } from './fetched-model-picker'
import { ModelProtocolEndpointCard } from './model-protocol-endpoint-card'
import { ProviderRuleBindings } from './provider-rule-bindings'
import type { FetchedProviderModel } from '@/api/providers'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingModel: { id: string; modelName: string } | null
  providerName: string
  modelId: string
  protocolEntries: ProtocolEndpointEntry[]
  saving: boolean
  fetchedModels: FetchedProviderModel[]
  fetchingModels: boolean
  selectedModelIds: string[]
  onFetchModels: () => void
  setModelId: (id: string) => void
  toggleModelSelection: (id: string, checked: boolean) => void
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
  onCancel: () => void
  onSave: () => void
}

export function ModelDialog(props: ModelDialogProps) {
  const {
    open,
    onOpenChange,
    editingModel,
    providerName,
    modelId,
    protocolEntries,
    saving,
    fetchedModels,
    fetchingModels,
    selectedModelIds,
    onFetchModels,
    setModelId,
    toggleModelSelection,
    updateProtocolEntry,
    onCancel,
    onSave,
  } = props

  const canSave = (editingModel ? modelId.trim() : selectedModelIds.length > 0 || modelId.trim()) && protocolEntries.some(entry => entry.enabled)

  const [modelSearch, setModelSearch] = useState('')
  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase()
    if (!keyword) return fetchedModels
    return fetchedModels.filter(model =>
      model.id.toLowerCase().includes(keyword) ||
      (model.displayName ?? '').toLowerCase().includes(keyword))
  }, [fetchedModels, modelSearch])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingModel ? '编辑供应商模型' : '添加供应商模型'}</DialogTitle>
          <DialogDescription>
            模型属于供应商 <span className="font-medium">{providerName}</span>，可配置多个协议接口。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2">
          {/* 模型 ID */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="model-id">模型 ID</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetchingModels}
                onClick={onFetchModels}
              >
                {fetchingModels ? '获取中…' : '从上游获取模型列表'}
              </Button>
            </div>
            <Input
              id="model-id"
              value={modelId}
              onChange={event => setModelId(event.target.value)}
              placeholder="例如：gpt-4o / claude-3-5-sonnet-20241022"
            />
            <p className="text-xs text-muted-foreground">
              这是上游供应商识别的模型名称，请求会原样转发。
            </p>

            <FetchedModelPicker
              modelId={modelId}
              multiSelect={!editingModel}
              selectedModelIds={selectedModelIds}
              fetchedModels={fetchedModels}
              modelSearch={modelSearch}
              setModelSearch={setModelSearch}
              setModelId={setModelId}
              toggleModelSelection={toggleModelSelection}
              filteredModels={filteredModels}
            />
            {!editingModel && selectedModelIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                已选择 {selectedModelIds.length} 个模型，保存后将批量添加。
              </p>
            )}
          </div>

          <Separator />

          {/* 协议端点 */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm">协议端点</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                至少启用一个协议；默认使用供应商级别的接口地址，也可以单独覆盖。
              </p>
            </div>

            {protocolEntries.map((entry, index) => (
              <ModelProtocolEndpointCard
                key={entry.protocol}
                entry={entry}
                index={index}
                updateProtocolEntry={updateProtocolEntry}
              />
            ))}
          </div>

          {editingModel && <ProviderRuleBindings providerModelId={editingModel.id} embedded />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button disabled={saving || !canSave} onClick={onSave}>
            {saving ? '保存中...' : editingModel ? '保存修改' : selectedModelIds.length > 0 ? `批量添加 ${selectedModelIds.length} 个模型` : '添加模型'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
