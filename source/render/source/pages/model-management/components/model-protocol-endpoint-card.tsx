import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ProtocolConversionSettings } from './protocol-conversion-settings'
import { ProtocolUrlHint } from './protocol-url-hint'
import { PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ModelProtocolEndpointCardProps {
  entry: ProtocolEndpointEntry
  index: number
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
}

export function ModelProtocolEndpointCard(props: ModelProtocolEndpointCardProps) {
  const { entry, index, updateProtocolEntry } = props
  const label = PROTOCOL_OPTIONS.find(option => option.value === entry.protocol)?.label

  return (
    <div
      className={cn('space-y-3 rounded-md bg-muted/30 p-3 transition-colors', !entry.enabled && 'opacity-60')}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
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
                  value={entry.endpointUrl}
                  onChange={event => updateProtocolEntry(index, { endpointUrl: event.target.value })}
                  placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]}
                />
              </div>
              <ProtocolUrlHint protocol={entry.protocol} />
            </>
          )}

          <ProtocolConversionSettings
            entry={entry}
            index={index}
            updateProtocolEntry={updateProtocolEntry}
          />
        </div>
      )}
    </div>
  )
}
