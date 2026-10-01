import { useState } from 'react'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'

interface SettingsNumberRowProps {
  title: string
  description: string
  value: number
  suffix: string
  placeholder: string
  min: number
  max: number
  /** 越界提示文案，由调用方翻译（带 {min} / {max} 插值）；草稿越界或初始值越界时显示。 */
  rangeErrorText: string
  onChange: (value: number) => void
}

/**
 * 带单位后缀的设置行；单位不参与命中区域，避免遮挡输入。
 *
 * 编辑期间输入框持有本地草稿，逐键自由输入，越界即时提示；收敛到
 * `[min, max]` 只发生在提交（blur / Enter）时——逐键 clamp 会把低于
 * 下限的中间态抬成下限值，让 `90` 这类目标值根本输不出来。设置项会被
 * 直接写入后端，提交时的收敛保证落库的值永远落在区间内。
 */
export function SettingsNumberRow(props: SettingsNumberRowProps) {
  const { title, description, value, suffix, placeholder, min, max, rangeErrorText, onChange } = props
  const [draft, setDraft] = useState<string | null>(null)

  const parsed = draft === null ? NaN : Number(draft)
  const outOfRange = draft !== null && draft.trim() !== '' && Number.isFinite(parsed)
    ? !Number.isInteger(parsed) || parsed < min || parsed > max
    : !Number.isInteger(value) || value < min || value > max

  const commit = () => {
    if (draft === null) return
    setDraft(null)
    const committed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(committed)) return
    onChange(Math.min(max, Math.max(min, Math.round(committed))))
  }

  return (
    <FormRow
      title={title}
      description={description}
      error={outOfRange ? rangeErrorText : undefined}
      control={(
        <div className="flex items-center gap-2">
          <Input
            aria-label={title}
            aria-invalid={outOfRange}
            className="w-24 text-right font-mono"
            min={min}
            max={max}
            placeholder={placeholder}
            type="number"
            value={draft ?? (Number.isFinite(value) ? value : '')}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') commit()
            }}
          />
          <span className="w-8 system-xs-regular text-text-tertiary">{suffix}</span>
        </div>
      )}
    />
  )
}
