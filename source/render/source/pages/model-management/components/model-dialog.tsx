import { useMemo, useState } from 'react'
import { Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ProtocolUrlHint } from './protocol-url-hint'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS, PROTOCOL_SHORT_LABELS } from '../lib/protocols'
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
  onFetchModels: () => void
  setModelId: (id: string) => void
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
    onFetchModels,
    setModelId,
    updateProtocolEntry,
    onCancel,
    onSave,
  } = props

  const canSave = modelId.trim() && protocolEntries.some(entry => entry.enabled)

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
      <DialogContent className="sm:max-w-2xl">
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

            {fetchedModels.length > 0 && (
              <div className="mt-2 space-y-2 rounded-md border">
                <Input
                  className="h-8 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  value={modelSearch}
                  onChange={event => setModelSearch(event.target.value)}
                  placeholder={`搜索 ${fetchedModels.length} 个模型…`}
                />
                <div className="max-h-48 overflow-y-auto p-1">
                  {filteredModels.length === 0 && (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的模型</p>
                  )}
                  {filteredModels.map(model => (
                    <button
                      key={model.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent',
                        model.id === modelId && 'bg-accent',
                      )}
                      onClick={() => setModelId(model.id)}
                    >
                      <span className="truncate font-mono">{model.id}</span>
                      {model.ownedBy && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">{model.ownedBy}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
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
              <div
                key={entry.protocol}
                className={cn('space-y-3 rounded-md bg-muted/30 p-3 transition-colors', !entry.enabled && 'opacity-60')}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {PROTOCOL_OPTIONS.find(o => o.value === entry.protocol)?.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{entry.enabled ? '已启用' : '未启用'}</span>
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={checked => updateProtocolEntry(index, { enabled: checked })}
                    />
                  </div>
                </div>

                {entry.enabled && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {entry.overrideUrl ? '使用自定义地址' : '使用供应商默认地址'}
                      </span>
                      <Switch
                        checked={entry.overrideUrl}
                        onCheckedChange={checked => updateProtocolEntry(index, { overrideUrl: checked })}
                      />
                    </div>

                    {entry.overrideUrl && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor={`model-endpoint-url-${index}`}>完整接口地址</Label>
                          <Input
                            id={`model-endpoint-url-${index}`}
                            type="url"
                            className="font-mono text-xs"
                            value={entry.upstreamUrl}
                            onChange={event => updateProtocolEntry(index, { upstreamUrl: event.target.value })}
                            placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]}
                          />
                        </div>
                        <ProtocolUrlHint protocol={entry.protocol} />
                      </>
                    )}

                    {/* 协议转换（端点级开关，仅在有支持的转换方向时展示） */}
                    {CONVERTIBLE_PROTOCOLS[entry.protocol].length > 0 && (
                    <div className="space-y-2 rounded-md border border-dashed border-border p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Repeat size={12} className="text-muted-foreground" />
                          <span className="text-xs font-medium">协议转换</span>
                        </div>
                        <Switch
                          checked={entry.protocolConversionEnabled}
                          onCheckedChange={checked => updateProtocolEntry(index, { protocolConversionEnabled: checked })}
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        开启后，此端点可接收其他协议的请求并自动转换（兼容层，部分参数可能丢失）
                      </p>
                      {entry.protocolConversionEnabled && (
                        <div className="flex flex-wrap gap-1">
                          {CONVERTIBLE_PROTOCOLS[entry.protocol].map(from => (
                            <span
                              key={from}
                              className="inline-flex items-center gap-1 rounded border border-dashed border-amber-500/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                            >
                              <Repeat size={9} />
                              {PROTOCOL_SHORT_LABELS[from]} → {PROTOCOL_SHORT_LABELS[entry.protocol]}
                            </span>
                          ))}
                          <p className="w-full text-[10px] leading-relaxed text-muted-foreground/80">原生请求优先；转换请求仅在没有原生候选时使用</p>
                        </div>
                      )}
                    </div>
                    )}
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
