import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ProviderEndpointCard } from './provider-endpoint-card'
import { ProviderFields } from './provider-fields'
import { ProviderPresetPicker } from './provider-preset-picker'
import type { ProviderPreset } from '../lib/provider-presets'
import type { ProviderEndpointEntry } from '../hooks/types'

interface ProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProviderId: string | null
  providerName: string
  apiKey: string
  timeout: string
  endpointEntries: ProviderEndpointEntry[]
  saving: boolean
  setProviderName: (name: string) => void
  setApiKey: (key: string) => void
  setTimeout: (timeout: string) => void
  updateEndpointEntry: (index: number, patch: Partial<ProviderEndpointEntry>) => void
  onCancel: () => void
  onSave: () => void
  onApplyPreset: (preset: ProviderPreset) => void
}

export function ProviderDialog(props: ProviderDialogProps) {
  const {
    open,
    onOpenChange,
    editingProviderId,
    providerName,
    apiKey,
    timeout,
    endpointEntries,
    saving,
    setProviderName,
    setApiKey,
    setTimeout,
    updateEndpointEntry,
    onCancel,
    onSave,
    onApplyPreset,
  } = props

  const canSave = Boolean(providerName.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingProviderId ? '编辑供应商' : '新建供应商'}</DialogTitle>
          <DialogDescription>API Key 可选；本地或测试集群等无需鉴权的上游可以留空。</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2">
          {!editingProviderId && (
            <ProviderPresetPicker providerName={providerName} onApplyPreset={onApplyPreset} />
          )}

          <ProviderFields
            editingProviderId={editingProviderId}
            providerName={providerName}
            apiKey={apiKey}
            timeout={timeout}
            setProviderName={setProviderName}
            setApiKey={setApiKey}
            setTimeout={setTimeout}
          />

          <Separator />

          {/* 协议默认地址 */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm">支持的协议默认接口地址</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                开启某个协议并填入默认地址；添加模型选择该协议时如不覆盖则沿用此地址。
              </p>
            </div>

            {endpointEntries.map((entry, index) => (
              <ProviderEndpointCard
                key={entry.protocol}
                entry={entry}
                index={index}
                updateEndpointEntry={updateEndpointEntry}
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button disabled={saving || !canSave} onClick={onSave}>
            {saving ? '保存中...' : editingProviderId ? '保存修改' : '创建供应商'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
