import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { CALENDAR_LOCALES } from '@/lib/calendar-locale'
import { formatLocalDate, formatLocalDateDisplay, parseLocalDate } from '@/lib/local-date'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocale, useTranslation } from '@/i18n/provider'

/**
 * 单日选择器。
 *
 * 与 `DateRangePicker` 同族：同一个触发按钮外观、同一个日历、同一个弹层骨架，
 * 区别只有 `mode="single"` 与底部的「清除」而不是区间预览。取代原来的原生 `type="date"`——
 * 那个框长什么样由操作系统决定，暗色下、Windows 与 macOS 上各不相同，也和旁边的一排筛选项对不上。
 *
 * 值是**本地日期串**（`YYYY-MM-DD`），空串表示未选。不用时间戳：使用者说的是「哪一天」，
 * 时刻口径留给调用方（比如「到期日当天结束后失效」）。换算在 `lib/local-date.ts`，有单测。
 */
interface DatePickerProps {
  value: string
  onChange: (next: string) => void
  /** 触发按钮的无障碍标签与悬停提示（字段标题由外层的 `FormField` 给）。 */
  label: string
  /** 未选时按钮上的占位文案。 */
  placeholder: string
  /**
   * 弹层底部那个「把值打回空」的按钮文案。
   *
   * 必须由调用方给：「清空」对「时间范围」是自明的，对「过期日期」却看不懂——
   * 用户要的是「永不过期」这个**结论**，而不是一个描述动作的动词。默认值只当作兜底。
   */
  clearLabel?: string
  id?: string
  className?: string
}

export function DatePicker(props: DatePickerProps) {
  const t = useTranslation()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)

  const selected = parseLocalDate(props.value)
  const display = formatLocalDateDisplay(props.value, locale)
  const empty = display === null

  function handleSelect(date: Date | undefined) {
    // 选中即收窗：单选没有「还差另一头」的中间态，留着弹层只是多一次点击。
    props.onChange(date ? formatLocalDate(date) : '')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={props.label}
          title={props.label}
          className={cn(
            // 与 `Input` 同一块底色，两者会出现在同一个表单里（名字输入框在上、这一行在下）。
            'justify-start gap-2 bg-components-input-bg-normal px-3 font-normal hover:bg-components-input-bg-hover aria-expanded:bg-components-input-bg-hover',
            props.className,
            empty ? 'text-components-input-text-placeholder' : 'text-components-input-text-filled',
          )}
        >
          <CalendarDays className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <span className="truncate">{display ?? props.placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          locale={CALENDAR_LOCALES[locale]}
          defaultMonth={selected}
          autoFocus
        />
        {/* 底部只留这一个动作，不放左侧的「当前选择」预览：区间选择器需要预览是因为两联日历
            一眼看不出跨度，而单选时那个高亮格就是当前值，再写一遍只是重复。 */}
        <div className="flex items-center justify-end border-t border-border/50 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              props.onChange('')
              setOpen(false)
            }}
            disabled={empty}
          >
            {props.clearLabel ?? t('common.action.clear')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
