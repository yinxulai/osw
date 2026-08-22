import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ProtocolUrlHint } from './protocol-url-hint'
import { PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProviderEndpointEntry } from '../hooks/types'

interface ProviderEndpointCardProps {
  entry: ProviderEndpointEntry
  index: number
  updateEndpointEntry: (index: number, patch: Partial<ProviderEndpointEntry>) => void
}

export function ProviderEndpointCard(props: ProviderEndpointCardProps) {
  const { entry, index, updateEndpointEntry } = props
  const label = PROTOCOL_OPTIONS.find(option => option.value === entry.protocol)?.label

  return (
    <div
      className={cn('space-y-3 rounded-md bg-muted/30 p-3 transition-colors', !entry.enabled && 'opacity-60')}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
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
  )
}
