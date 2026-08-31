import { useEffect, useState } from 'react'
import { Gift, RefreshCw, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Spinner } from '@/components/ui/spinner'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSettings } from '@/features/settings/hooks'
import { ProviderIcon } from './provider-icon'
import { useFreeModels } from '../hooks/use-free-models'
import type { FreeModelSourceInfo } from '@/api/free-models'

function formatTime(time: number | null): string {
  if (!time) return '从未同步'
  try {
    return new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '从未同步'
  }
}

const INTERVAL_OPTIONS = [6, 12, 24, 48, 168]

interface SourceCardProps {
  source: FreeModelSourceInfo
  busy: boolean
  onEnable: (key: string, apiKey?: string) => void
  onDisable: (key: string) => void
  onSync: (key: string) => void
  onUpdateKey: (key: string, apiKey: string) => void
}

function SourceCard(props: SourceCardProps) {
  const { source, busy } = props
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const confirm = useConfirm()

  const state = source.syncState
  const syncing = busy

  const handleDisable = async () => {
    const confirmed = await confirm({
      title: `停用“${source.name}”？`,
      description: '将移除自动创建的渠道及其全部免费模型，之后可随时重新启用。',
      confirmLabel: '停用',
      variant: 'destructive',
    })
    if (confirmed) await props.onDisable(source.key)
  }

  const handleSaveKey = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    await props.onUpdateKey(source.key, trimmed)
    setApiKey('')
    setShowKey(false)
  }

  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{ color: 'var(--primary)', backgroundColor: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}
          >
            <ProviderIcon name={source.providerName} size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium">{source.name}</span>
              {source.enabled
                ? <Badge variant="success" className="text-[10px]">已启用</Badge>
                : <Badge variant="muted" className="text-[10px]">未启用</Badge>}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{source.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {source.enabled && (
            <Button variant="outline" size="sm" disabled={syncing} onClick={() => props.onSync(source.key)}>
              {syncing ? <Spinner className="size-3.5" /> : <RefreshCw size={13} />} 立即同步
            </Button>
          )}
          {source.enabled
            ? <Button variant="ghost" size="sm" className="text-destructive" disabled={syncing} onClick={() => void handleDisable()}>停用</Button>
            : <Button size="sm" disabled={syncing} onClick={() => props.onEnable(source.key, apiKey.trim() || undefined)}>
                {syncing ? <Spinner className="size-3.5" /> : <Gift size={13} />} 启用
              </Button>}
        </div>
      </div>

      {!source.enabled && (
        <div className="mt-3 space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">API Key（可选）</Label>
          <Input
            type="password"
            className="h-8 text-sm"
            placeholder={source.apiKeyPlaceholder ?? 'sk-...'}
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
          />
          {source.apiKeyHelpText && <p className="text-[10.5px] text-muted-foreground">{source.apiKeyHelpText}</p>}
        </div>
      )}

      {source.enabled && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>免费模型 <span className="font-medium text-foreground">{source.modelCount}</span> 个</span>
            <span>上次同步：{formatTime(state?.time ?? null)}</span>
            {state?.status === 'error' && <span className="text-destructive">同步失败：{state.error}</span>}
          </div>
          <div>
            <button className="flex items-center gap-1 text-[11px] text-primary hover:underline" onClick={() => setShowKey(value => !value)}>
              <KeyRound size={11} /> {showKey ? '取消更新 Key' : '更新 API Key'}
            </button>
            {showKey && (
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  type="password"
                  className="h-8 text-sm"
                  placeholder={source.apiKeyPlaceholder ?? 'sk-...'}
                  value={apiKey}
                  onChange={event => setApiKey(event.target.value)}
                />
                <Button size="sm" variant="outline" disabled={syncing || !apiKey.trim()} onClick={() => void handleSaveKey()}>保存</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface FreeModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FreeModelsDialog(props: FreeModelsDialogProps) {
  const { sources, loading, busyKey, enable, disable, sync, updateKey, updateAutoSync } = useFreeModels()
  const settings = useSettings()
  const [autoSync, setAutoSync] = useState(settings?.freeModelAutoSyncEnabled ?? true)
  const [intervalHours, setIntervalHours] = useState(settings?.freeModelSyncIntervalHours ?? 12)

  useEffect(() => {
    if (settings) {
      setAutoSync(settings.freeModelAutoSyncEnabled)
      setIntervalHours(settings.freeModelSyncIntervalHours)
    }
  }, [settings])

  const intervalLabel = (hours: number) => hours === 168 ? '每周' : hours === 24 ? '每天' : hours === 48 ? '每 2 天' : `每 ${hours} 小时`

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>免费模型源</DialogTitle>
          <DialogDescription>
            一键接入提供免费模型的渠道，系统会自动拉取并维护当前免费的模型；免费模型变动时自动增删。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-1 py-2">
          {loading && sources.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner /> 加载中...
            </div>
          ) : (
            sources.map(source => (
              <SourceCard
                key={source.key}
                source={source}
                busy={busyKey === source.key}
                onEnable={enable}
                onDisable={disable}
                onSync={sync}
                onUpdateKey={updateKey}
              />
            ))
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
            <div>
              <div className="text-[13px] font-medium">自动同步</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">后台定期刷新免费模型列表，自动增删已变动的模型。</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {autoSync && (
                <NativeSelect
                  size="sm"
                  value={intervalHours}
                  onChange={event => {
                    const value = Number(event.target.value)
                    setIntervalHours(value)
                    void updateAutoSync(true, value)
                  }}
                >
                  {INTERVAL_OPTIONS.map(hours => (
                    <NativeSelectOption key={hours} value={hours}>{intervalLabel(hours)}</NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <Switch
                checked={autoSync}
                onCheckedChange={checked => { setAutoSync(checked); void updateAutoSync(checked, intervalHours) }}
                aria-label="自动同步开关"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
