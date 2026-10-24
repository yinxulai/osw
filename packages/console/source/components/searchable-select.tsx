'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface SearchableSelectOption {
  value: string
  label: string
}

interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  /** 触发按钮的无障碍标签。 */
  label: string
  /** 「全部」这一项：`value` 与 `label` 由调用方给（通常是 `'all'` + 本地化的「全部」）。 */
  allOption: SearchableSelectOption
  /** 搜索框占位文案。 */
  searchPlaceholder: string
  /** 搜不到时的提示文案。 */
  emptyLabel: string
  className?: string
}

/**
 * 可搜索的单选下拉。
 *
 * 与 shadcn `Select` 的区别只有一个：候选多到需要搜索框（供应商模型动辄几十上百条）。
 * 形态沿用全应用的下拉：`Button variant="outline"` 当触发器，浮层走 cmdk `Command`
 * （`shouldFilter={false}` + 自己按 label / value 过滤，与新增模型的对话框同一套）。
 *
 * 之所以不用 `ui/select` + 塞一个输入框：那个原语的键盘导航 / 高亮是它自己的，
 * 替不掉；而 `Command` 的「打字即筛、上下键选、回车确认」是现成的。
 */
export function SearchableSelect(props: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  const items = useMemo(() => [props.allOption, ...props.options], [props.allOption, props.options])
  const selectedLabel = items.find(item => item.value === props.value)?.label ?? ''

  const query = keyword.trim().toLowerCase()
  const filtered = query === ''
    ? items
    : items.filter(item => `${item.label} ${item.value}`.toLowerCase().includes(query))

  function pick(value: string) {
    setOpen(false)
    setKeyword('')
    props.onValueChange(value)
  }

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setKeyword('') }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={props.label}
          title={props.label}
          className={cn(
            // 筛选栏里这一排控件（可搜索下拉 / 协议 / 状态）统一用 `components-input-bg-normal`，
            // 时间选择器也走同一底色，四者一致；`outline` 变体默认的白底会在这里显得突兀。
            'justify-between gap-1.5 bg-components-input-bg-normal px-3 font-normal hover:bg-components-input-bg-hover aria-expanded:bg-components-input-bg-hover',
            props.className,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-text-quaternary" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput value={keyword} onValueChange={setKeyword} placeholder={props.searchPlaceholder} />
          <CommandList className="max-h-72">
            {filtered.length === 0 && <CommandEmpty>{props.emptyLabel}</CommandEmpty>}
            {filtered.map(item => (
              <CommandItem key={item.value} value={item.value} onSelect={() => pick(item.value)}>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Check className={cn('size-3.5 shrink-0', item.value === props.value ? 'opacity-100' : 'opacity-0')} aria-hidden />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
