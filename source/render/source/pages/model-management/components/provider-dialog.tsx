import { KeyRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ProtocolUrlHint } from './protocol-url-hint'
import { ProviderIcon } from './provider-icon'
import { PROVIDER_PRESETS, type ProviderPreset } from '../lib/provider-presets'
import { PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS } from '../lib/protocols'
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingProviderId ? '编辑供应商' : '新建供应商'}</DialogTitle>
          <DialogDescription>API Key 可选；本地或测试集群等无需鉴权的上游可以留空。</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2">
          {/* 快速选择预设 */}
          {!editingProviderId && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">快速选择</Label>
              <div className="flex flex-wrap gap-2">
                {PROVIDER_PRESETS.map(preset => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => onApplyPreset(preset)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs font-medium transition-colors',
                      'hover:bg-muted',
                      providerName === preset.name && 'bg-primary/10 text-primary',
                    )}
                  >
                    <span style={{ color: preset.color }}>
                      <ProviderIcon name={preset.name} size={14} />
                    </span>
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 基础信息 */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="provider-name">供应商名称</Label>
                <Input
                  id="provider-name"
                  value={providerName}
                  onChange={event => setProviderName(event.target.value)}
                  placeholder="例如：OpenAI / DeepSeek"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-key">API Key（可选）</Label>
                <div className="relative">
                  <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="provider-key"
                    type="password"
                    className="pl-8"
                    value={apiKey}
                    onChange={event => setApiKey(event.target.value)}
                    placeholder={editingProviderId ? '留空表示不修改' : '可选，例如 sk-...'}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">仅保存在本机；无需鉴权的上游可以留空。</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-timeout">请求超时（毫秒）</Label>
                <Input
                  id="provider-timeout"
                  type="number"
                  min={1}
                  value={timeout}
                  onChange={event => setTimeout(event.target.value)}
                  placeholder="例如：30000"
                />
                <p className="text-[11px] text-muted-foreground">超时后自动切换下一个候选模型，默认 30 秒（30000 毫秒）。</p>
              </div>
            </div>
          </div>

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
              <div
                key={entry.protocol}
                className={cn('space-y-3 rounded-md bg-muted/30 p-3 transition-colors', !entry.enabled && 'opacity-60')}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {PROTOCOL_OPTIONS.find(o => o.value === entry.protocol)?.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{entry.enabled ? '已配置' : '未配置'}</span>
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={checked => updateEndpointEntry(index, { enabled: checked })}
                    />
                  </div>
                </div>

                {entry.enabled && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`provider-endpoint-url-${index}`}>完整接口地址</Label>
                      <Input
                        id={`provider-endpoint-url-${index}`}
                        type="url"
                        className="font-mono text-xs"
                        value={entry.url}
                        onChange={event => updateEndpointEntry(index, { url: event.target.value })}
                        placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]}
                      />
                    </div>
                    <ProtocolUrlHint protocol={entry.protocol} />
                  </div>
                )}
              </div>
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
