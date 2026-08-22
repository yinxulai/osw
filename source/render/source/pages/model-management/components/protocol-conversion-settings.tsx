import { Repeat } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { PROTOCOL_SHORT_LABELS } from '../lib/protocols'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ProtocolConversionSettingsProps {
  entry: ProtocolEndpointEntry
  index: number
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
}

export function ProtocolConversionSettings(props: ProtocolConversionSettingsProps) {
  const { entry, index, updateProtocolEntry } = props
  const convertibleProtocols = CONVERTIBLE_PROTOCOLS[entry.protocol]

  if (convertibleProtocols.length === 0) return null

  return (
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
          {convertibleProtocols.map(from => (
            <span
              key={from}
              className="inline-flex items-center gap-1 rounded border border-dashed border-amber-500/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            >
              <Repeat size={9} />
              {PROTOCOL_SHORT_LABELS[from]} → {PROTOCOL_SHORT_LABELS[entry.protocol]}
            </span>
          ))}
          <p className="w-full text-[10px] leading-relaxed text-muted-foreground/80">
            原生请求优先；转换请求仅在没有原生候选时使用
          </p>
        </div>
      )}
    </div>
  )
}
