import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ProtocolUrlHint } from './protocol-url-hint'
import { PROTOCOL_DESCRIPTIONS, PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS } from '../lib/protocols'
import type { BindingEntry } from '../service'

interface ModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingModel: { id: string; upstreamModelId: string } | null
  providerName: string
  modelId: string
  bindingEntries: BindingEntry[]
  saving: boolean
  setModelId: (id: string) => void
  updateBindingEntry: (index: number, patch: Partial<BindingEntry>) => void
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
    bindingEntries,
    saving,
    setModelId,
    updateBindingEntry,
    onCancel,
    onSave,
  } = props

  const canSave = modelId.trim() && bindingEntries.some(entry => entry.enabled)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingModel ? '编辑上游模型' : '添加上游模型'}</DialogTitle>
          <DialogDescription>
            模型属于供应商 <span className="font-medium">{providerName}</span>，可配置多个协议接口。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2">
          {/* 模型 ID */}
          <div className="space-y-1.5">
            <Label htmlFor="model-id">模型 ID</Label>
            <Input
              id="model-id"
              value={modelId}
              onChange={event => setModelId(event.target.value)}
              placeholder="例如：gpt-4o / claude-3-5-sonnet-20241022"
            />
            <p className="text-[11px] text-muted-foreground">
              这是上游供应商识别的模型名称，请求会原样转发。
            </p>
          </div>

          <Separator />

          {/* 协议绑定 */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm">协议绑定</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                至少启用一个协议；默认使用供应商级别的接口地址，也可以单独覆盖。
              </p>
            </div>

            {bindingEntries.map((entry, index) => (
              <div
                key={entry.protocol}
                className={cn('space-y-3 rounded-md bg-muted/30 p-3 transition-colors', !entry.enabled && 'opacity-60')}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {PROTOCOL_OPTIONS.find(o => o.value === entry.protocol)?.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{entry.enabled ? '已启用' : '未启用'}</span>
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={checked => updateBindingEntry(index, { enabled: checked })}
                    />
                  </div>
                </div>

                {entry.enabled && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {entry.overrideUrl ? '使用自定义地址' : '使用供应商默认地址'}
                      </span>
                      <Switch
                        checked={entry.overrideUrl}
                        onCheckedChange={checked => updateBindingEntry(index, { overrideUrl: checked })}
                      />
                    </div>

                    {entry.overrideUrl && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`model-endpoint-url-${index}`}>完整接口地址</Label>
                        <Input
                          id={`model-endpoint-url-${index}`}
                          type="url"
                          className="font-mono text-xs"
                          value={entry.upstreamUrl}
                          onChange={event => updateBindingEntry(index, { upstreamUrl: event.target.value })}
                          placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]}
                        />
                      </div>
                    )}

                    <p className="text-[11px] text-muted-foreground">{PROTOCOL_DESCRIPTIONS[entry.protocol]}</p>
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
            {saving ? '保存中...' : editingModel ? '保存修改' : '添加模型'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
