import * as React from 'react'
import { enUS, zhCN } from 'react-day-picker/locale'
import type { DateRange } from 'react-day-picker'
import { CalendarRange } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocale, useTranslation } from '@/i18n/provider'

/**
 * 日期区间选择器。
 *
 * 一个触发按钮开一个 Popover：左边一列预设（今天 / 近 7 天 / 近 30 天），右边两联日历，
 * 底部是当前选择与清除。取代原来并排的两个原生 `type="date"` 输入框 —— 那两个框各管一头，
 * 用户看不出「这是一个区间」，也没法一眼看出跨度。
 *
 * 取值口径刻意保持「日粒度、含首含尾」：`from` / `to` 都是**当天本地零点**的时间戳。
 * 不在这里掺时刻（比如「结束日要不要 +1 天」），那是各调用方自己的查询口径，
 * 让它们在外层换算，组件只保证「选了哪两天」是明确的。
 */
export interface DateRangeValue {
  /** 起始日（含当天），当天本地零点的毫秒时间戳；null 表示未选。 */
  from: number | null
  /** 结束日（含当天），当天本地零点的毫秒时间戳；null 表示未选。 */
  to: number | null
}

interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  /** 触发按钮的无障碍标签与悬停提示（区间本身没有可见标题）。 */
  label: string
  className?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 语言 → 日历标签（月份、星期、翻页按钮的 aria 文案）。 */
const CALENDAR_LOCALES = { en: enUS, 'zh-CN': zhCN } as const

/** 到「当天本地零点」。用年月日构造而不是 `setHours(0,0,0,0)`，后者在夏令时切换当天会偏一小时。 */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatDay(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp)
}

function formatValue(value: DateRangeValue, locale: string): string | null {
  const { from, to } = value
  if (from === null && to === null) return null
  if (from !== null && to !== null) return `${formatDay(from, locale)} – ${formatDay(to, locale)}`
  if (from !== null) return `${formatDay(from, locale)} –`
  return `– ${formatDay(to!, locale)}`
}

const PRESETS = [
  { key: 'common.dateRange.today', days: 0 },
  { key: 'common.dateRange.last7Days', days: 6 },
  { key: 'common.dateRange.last30Days', days: 29 },
] as const

export function DateRangePicker(props: DateRangePickerProps) {
  const t = useTranslation()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)

  const selected: DateRange | undefined =
    props.value.from === null && props.value.to === null
      ? undefined
      : {
          from: props.value.from === null ? undefined : new Date(props.value.from),
          to: props.value.to === null ? undefined : new Date(props.value.to),
        }

  const display = formatValue(props.value, locale)
  const empty = display === null

  function handleSelect(range: DateRange | undefined) {
    props.onChange({
      from: range?.from ? startOfDay(range.from.getTime()) : null,
      to: range?.to ? startOfDay(range.to.getTime()) : null,
    })
    // 区间选满即收起：留着只会挡住背后的内容，再改就重新点开（那本来也是一次完整选择）。
    if (range?.from && range?.to) setOpen(false)
  }

  function applyPreset(days: number) {
    const end = startOfDay(Date.now())
    props.onChange({ from: startOfDay(end - days * DAY_MS), to: end })
    setOpen(false)
  }

  function clear() {
    props.onChange({ from: null, to: null })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={props.label}
          title={props.label}
          className={cn(
            'justify-start gap-2 px-3 font-normal',
            props.className,
            empty ? 'text-components-input-text-placeholder' : 'text-components-input-text-filled',
          )}
        >
          <CalendarRange className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <span className="truncate">{display ?? t('common.dateRange.placeholder')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex">
          <div className="flex w-28 flex-col gap-0.5 border-r border-border/50 p-2">
            {PRESETS.map(preset => (
              <Button
                key={preset.key}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start font-normal"
                onClick={() => applyPreset(preset.days)}
              >
                {t(preset.key)}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            selected={selected}
            onSelect={handleSelect}
            numberOfMonths={2}
            locale={CALENDAR_LOCALES[locale]}
            defaultMonth={props.value.from === null ? undefined : new Date(props.value.from)}
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border/50 px-3 py-2">
          <span className={cn('system-xs-regular', empty ? 'text-text-tertiary' : 'text-text-secondary')}>
            {display ?? t('common.dateRange.placeholder')}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={clear} disabled={empty}>
            {t('common.action.clear')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
