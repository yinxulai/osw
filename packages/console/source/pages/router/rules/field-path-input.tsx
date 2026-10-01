import { useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { RULE_PATH_HINTS, type RulePathHint } from './rule-path-hints'

interface FieldPathInputProps {
  value: string
  onChange: (value: string) => void
  /** 这一格在屏幕上没有可见标签，读屏得能问出「这是什么」 */
  ariaLabel: string
  /** 值还空着时的提示语 */
  placeholder: string
  /** 只给这一格占位的尺寸类（`flex-1` / `max-w-80` …）；输入框自身铺满这一格 */
  className?: string
  hints?: readonly RulePathHint[]
}

/**
 * 字段路径输入框 —— 能手写，也能从候选里点一条。
 *
 * 规则模式里有两个格子要填**字段路径**（条件里的「与另一个字段比较」、落点里的「用请求里的字段」），
 * 它们此前都是一个光秃秃的文本框：路径是引擎的私有语法（`logicalModels[*].modelId` 里的通配投影、
 * `request.headers.` 之后的整段都算头名），屏幕上没有任何地方写着它，只能靠记住。
 * 图侧这两处都是下拉候选，规则模式却退化成了凭记忆敲 —— 同一个概念在两种模式里不该差这么远。
 *
 * 候选只是**提示**，不是白名单：手写的路径一样生效（引擎读的就是这一串字符串），
 * 所以这里坚持用可输入的框而不是 `Select` —— 换成一个只能选的下拉，等于把「写得出的路径」
 * 缩成「表里列出的路径」，那是拿界面去改引擎的语义。
 *
 * 键盘与逻辑模型多选框保持同一套：打字筛，回车取筛出来的第一条；候选行在 `mousedown` 时
 * 阻止默认行为，光标因此始终留在框里（焦点一走、列表就关，那一下点击会落空）。
 * **不做**上下键高亮：这个列表一屏能看完、且随打字收敛到一两行，多绕一圈只是慢。
 */
export function FieldPathInput(props: FieldPathInputProps) {
  const { value, onChange, ariaLabel, placeholder, className, hints = RULE_PATH_HINTS } = props
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const noteOf = (hint: RulePathHint): string => (hint.noteKey ? t(hint.noteKey) : '')
  const keyword = value.trim().toLowerCase()
  // 筛的是行里看得见的两样：路径与它读到的东西。少筛一样，列表就会跟框里打的字互相打脸。
  const visible = keyword
    ? hints.filter(hint => hint.path.toLowerCase().includes(keyword) || noteOf(hint).toLowerCase().includes(keyword))
    : hints

  const pick = (path: string) => {
    onChange(path)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/*
        用 Anchor 而不是 Trigger：这一格真正可交互的是输入框本身，
        Trigger 会把自己的按钮语义盖在整格上（`role=button` 的盒子里再套 `input` 是错的）。
        Anchor 这里也不能 `asChild` 到 `Input` 上 —— 它不是 `forwardRef`，ref 会落在 React 拿不到的地方。
      */}
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn('min-w-0', className)}>
          <Input
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className="h-8 w-full font-mono"
            value={value}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={event => {
              onChange(event.target.value)
              setOpen(true)
            }}
            onKeyDown={event => {
              // 打字筛出的第一条就是「想填的那个」，回车即取 —— 比再去够鼠标省一整趟。
              if (event.key !== 'Enter' || !open) return
              const first = visible[0]
              if (!first) return
              event.preventDefault()
              pick(first.path)
            }}
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        // 焦点留在输入框里 —— 正是它录入了这一点关键字，弹层再去抢焦点，「边打边筛」就断了。
        onOpenAutoFocus={event => event.preventDefault()}
        // 输入框在锚点里，按 Radix 的默认判定它算「层外」，点一下就会把列表关掉，
        // 而那恰恰是最常发生的动作（接着往下打）。锚点内的一律不算「点到了外面」。
        onInteractOutside={event => {
          const target = event.detail.originalEvent.target
          if (target instanceof Node && anchorRef.current?.contains(target)) event.preventDefault()
        }}
        // 至少 288px：候选行是「路径 + 一句解释」，跟输入框一样宽时解释会被截成半句话。
        // 宽度仍以输入框为基准（看起来就是这一格摊开了），只是窄格子不再把说明挤没。
        className="w-(--radix-popper-anchor-width) min-w-72 gap-0 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1.5 shadow-none ring-0"
      >
        <div id={listId} role="listbox" className="max-h-72 overflow-y-auto">
          {visible.map(hint => {
            const selected = hint.path === value
            const note = noteOf(hint)
            return (
              <button
                key={hint.path}
                type="button"
                role="option"
                aria-selected={selected}
                className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-state-base-hover"
                // 不让这一次按下把焦点从输入框带走：焦点一走、列表就关，而 React 会在 click 之前
                // 把列表卸掉，这一下点击等于没发生。
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(hint.path)}
              >
                <span className="flex h-4 shrink-0 items-center justify-center">
                  {selected && <Check className="size-3.5 text-primary" aria-hidden />}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  {/* 路径本身用等宽字体：它是引擎的语法，不是一句话，读起来得跟它被写下的样子一致。 */}
                  <span className="truncate font-mono system-xs-regular text-text-primary">{hint.path}</span>
                  {/* 读到的是什么：光看路径猜不出 `route.protocol` 与 `request.method` 的区别。
                      第二行而不是跟在路径后面 —— 说明是一句话，挤在同一行两边都会截断。 */}
                  {note && <span className="truncate system-2xs-regular text-text-tertiary" title={note}>{note}</span>}
                </span>
              </button>
            )
          })}

          {visible.length === 0 && (
            <div className="px-2 py-4 text-center system-xs-regular text-text-tertiary">{t('router.rules.pathHint.empty')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
