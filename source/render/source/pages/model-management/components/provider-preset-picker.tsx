import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { ProviderIcon } from './provider-icon'
import { PROVIDER_PRESETS, type ProviderPreset } from '../lib/provider-presets'

interface ProviderPresetPickerProps {
  providerName: string
  onApplyPreset: (preset: ProviderPreset) => void
}

export function ProviderPresetPicker(props: ProviderPresetPickerProps) {
  const { providerName, onApplyPreset } = props

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">快速选择</Label>
      <div className="flex flex-wrap gap-2">
        {PROVIDER_PRESETS.map(preset => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onApplyPreset(preset)}
            className={cn(
              'flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs font-medium transition-colors',
              'hover:bg-muted',
              providerName === preset.name && 'bg-primary/10 text-primary',
            )}
          >
            <span style={{ color: preset.color }}>
              <ProviderIcon name={preset.name} size={18} />
            </span>
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  )
}
