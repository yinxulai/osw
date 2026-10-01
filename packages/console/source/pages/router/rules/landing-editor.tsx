import { useId, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { RouteRuleLanding } from '@common/router/route-rules'
import type { LogicalModel } from '@common/schemas'
import { FieldPathInput } from './field-path-input'
import { RULE_VARIABLE_PATH_HINTS } from './rule-path-hints'

interface RuleFieldLabelProps {
  children: string
}

/** 规则模式的字段标签：小号大写，与「正在编辑」和「只在读」两种状态一眼区分得开。 */
export function RuleFieldLabel(props: RuleFieldLabelProps) {
  return <span className="system-2xs-medium-uppercase text-text-quaternary">{props.children}</span>
}

interface LogicalModelPickerProps {
  emptyHint: string
  logicalModels: LogicalModel[]
  selectedIds: string[]
  onToggle: (modelId: string, checked: boolean) => void
}

/**
 * 逻辑模型多选框。
 *
 * 与图里的逻辑模型选择节点选的是同一份模型、同一套优先级语义（**勾选顺序即优先级**），
 * 但控件形态按规则表这一栏的读法来定：选出来的是**一串有序 id**，而这串 id 本身既要看得见、
 * 又要能逐个拿掉、还要能继续往后加 —— 那正好就是一个输入框：已选项是框里的 chip（带优先级序号），
 * 光标所在的地方永远可以接着打关键字，候选列表从框的正下方展开、宽度与框一致。
 *
 * 一排 chip + 一个「添加模型」按钮 + 弹层里再放一个搜索框的写法，把同一次选择拆成两处入口，
 * 而多出来的那个按钮并不能回答这里唯一的问题 —— 「现在有谁、顺序如何、还要加谁」。
 *
 * 候选列表不跳过已选项：跳过之后就没法取消勾选、也没法确认「它是不是已经在里面了」，
 * 而这两件事恰恰是配置落点最常要做的。列表里已选在前（维持勾选顺序）并标出序号，
 * 点一行切换一行，弹层不关 —— 连续勾几个是常态，因此也没有「全部选完」这种提示语。
 *
 * 键盘就两条，都是「光标在这一格里时最想做的事」：选项由打字筛出来，回车切换筛出来的第一条；
 * 空格上按退格退回上一个选择（跟所有标签输入框一致）。**不做**上下键高亮 + 回车确认那一套：
 * 这个列表一屏能看完、且随打字收敛到一两行，光标还在原地，「用箭头在候选里走一遭」比直接回车多绕一圈。
 *
 * 一个逻辑模型都没有时不摆一个点不开的空框：直接把原因说清楚。
 */
export function LogicalModelPicker(props: LogicalModelPickerProps) {
  const { emptyHint, logicalModels, selectedIds, onToggle } = props
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  if (logicalModels.length === 0) {
    return <span className="system-xs-regular text-text-warning">{emptyHint}</span>
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setKeyword('')
  }

  const normalizedKeyword = keyword.trim().toLowerCase()
  // 已选在前（维持勾选顺序 = 优先级），其余按名字排在后面：打开面板第一眼就是当前的优先级顺序。
  const ordered = [...logicalModels].sort((left, right) => {
    const leftIndex = selectedIds.indexOf(left.modelId)
    const rightIndex = selectedIds.indexOf(right.modelId)
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
    if (leftIndex >= 0) return -1
    if (rightIndex >= 0) return 1
    return left.modelId.localeCompare(right.modelId)
  })
  const visible = normalizedKeyword
    // 筛的就是行里看得见的那两样：模型 id 与描述。少筛一样，列表就会跟搜索框互相打脸 ——
    // 明明眼前写着 fallback，打进去却说没有匹配。
    ? ordered.filter(model => [model.modelId, model.description].some(field => field.toLowerCase().includes(normalizedKeyword)))
    : ordered

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/*
        用 Anchor 而不是 Trigger：框里装着输入框和 chip，它们才是这一格真正可交互的东西，
        Trigger 会把自己的按钮语义盖在整格上（一个 role=button 的盒子里再套 input 是错的）。
        标签页也会抢焦点，所以候选行在 mousedown 时阻止默认行为，光标始终留在输入框里。
      */}
      <PopoverAnchor asChild>
        <div
          ref={fieldRef}
          // 外框抄 `Input` 的那一套（同一栏里两个输入框长得不一样，比什么都显眼）：
          // 连同高度一起对齐 —— 内边距按 h-8 反推，别让这一格比上面的规则名高出 2px。
          className="flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-0.5 transition-colors hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active"
          onClick={() => {
            inputRef.current?.focus()
            setOpen(true)
          }}
          // 焦点离开这一格就收起来：列表属于这个框，焦点都不在这一格里了还挂着只会挡别的字段。
          onBlur={event => {
            const next = event.relatedTarget
            if (next instanceof Node && fieldRef.current?.contains(next)) return
            handleOpenChange(false)
          }}
        >
          {selectedIds.map((modelId, index) => {
            const model = logicalModels.find(item => item.modelId === modelId)
            const name = model?.modelId ?? modelId
            return (
              <span
                key={modelId}
                className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-module-border bg-workflow-block-parma-bg pl-1.5 pr-0.5 system-xs-regular text-text-secondary"
              >
                <span className="shrink-0 font-mono system-2xs-regular text-text-quaternary">{index + 1}</span>
                <span className="max-w-44 truncate">{name}</span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('router.rules.removeModel', { name })}
                  className="size-4 shrink-0 text-text-tertiary hover:bg-transparent hover:text-text-secondary"
                  // 同上：点叉不该把光标从输入框里带走，否则框先失焦、弹层先关，这一下就白点了。
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => {
                    event.stopPropagation()
                    onToggle(modelId, false)
                  }}
                >
                  <X className="size-3" aria-hidden />
                </Button>
              </span>
            )
          })}

          <input
            ref={inputRef}
            role="combobox"
            aria-label={t('router.rules.pickModelSearch')}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            value={keyword}
            placeholder={t('router.rules.pickModelSearch')}
            className="h-6 min-w-40 flex-1 bg-transparent system-xs-regular text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder"
            onChange={event => {
              setKeyword(event.target.value)
              setOpen(true)
            }}
            onKeyDown={event => {
              // 打字筛出的第一条就是「想加的那个」，回车即切换 —— 比再去够鼠标省一整趟。
              if (event.key === 'Enter') {
                event.preventDefault()
                const first = visible[0]
                if (first) onToggle(first.modelId, !selectedIds.includes(first.modelId))
                return
              }
              // 光标已经在最前面、还没有打任何字时，退格退回上一个选择：删掉刚加错的那个不用去够那个叉。
              if (event.key === 'Backspace' && keyword.length === 0) {
                const last = selectedIds[selectedIds.length - 1]
                if (last === undefined) return
                event.preventDefault()
                onToggle(last, false)
              }
            }}
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        // 焦点留在输入框里 —— 正是它录入了这一点内容，弹层再去抢焦点，「边打边筛」就断了。
        onOpenAutoFocus={event => event.preventDefault()}
        // 输入框与 chip 都在锚点里，按 Radix 的默认判定它们算「层外」，点一下就会把列表关掉，
        // 而那恰恰是最常发生的动作（接着筛、去掉一个）。锚点内的一律不算「点到了外面」。
        onInteractOutside={event => {
          const target = event.detail.originalEvent.target
          if (target instanceof Node && fieldRef.current?.contains(target)) event.preventDefault()
        }}
        // 宽度跟框一样：列表看起来就是这一格摊开了，而不是另开一个尺寸无关的浮层。
        className="w-(--radix-popper-anchor-width) gap-0 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1.5 shadow-none ring-0"
      >
        <div id={listId} role="listbox" aria-multiselectable className="max-h-72 overflow-y-auto">
          {visible.map(model => {
            const priority = selectedIds.indexOf(model.modelId)
            const selected = priority >= 0
            return (
              <button
                key={model.modelId}
                type="button"
                role="option"
                aria-selected={selected}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-state-base-hover"
                // 不让这一次按下把焦点从输入框带走：焦点一走，框就失焦、列表就关，
                // 而 React 会在 click 之前把列表卸掉，这一下点击等于没发生。
                onMouseDown={event => event.preventDefault()}
                onClick={() => onToggle(model.modelId, !selected)}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-[5px] border',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {selected && <Check className="size-3" aria-hidden />}
                </span>
                {/* 序号只在已选时出现：它就是 chip 上那个数字，两边指的是同一件事（优先级）。 */}
                <span className="w-3 shrink-0 font-mono system-2xs-regular text-text-quaternary">{selected ? priority + 1 : ''}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono system-xs-medium text-text-primary">{model.modelId}</span>
                  {model.description
                    ? <span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{model.description}</span>
                    : null}
                </span>
              </button>
            )
          })}

          {visible.length === 0 && (
            <div className="px-2 py-4 text-center system-xs-regular text-text-tertiary">{t('router.rules.pickModelEmpty')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface LandingSourceOption {
  value: RouteRuleLanding['source']
  labelKey: 'router.rules.landingFixed' | 'router.rules.landingVariable'
}

/** 落点的两种取法。顺序即展示顺序：先「点名几个模型」，再「听请求的」。 */
const LANDING_SOURCES: readonly LandingSourceOption[] = [
  { value: 'fixed', labelKey: 'router.rules.landingFixed' },
  { value: 'variable', labelKey: 'router.rules.landingVariable' },
]

interface LandingEditorProps {
  landing: RouteRuleLanding
  logicalModels: LogicalModel[]
  onChange: (landing: RouteRuleLanding) => void
}

/**
 * 一条规则的落点。
 *
 * 两种取法与图里的逻辑模型选择节点一一对应：`fixed` 勾选指定模型，`variable` 把请求里某个字段的取值
 * 直接当逻辑模型 id（「请求哪个模型就直连哪个」这条最常见的规则就是它）。
 *
 * 「哪一种取法」是**二选一**，所以用 radio：它是同一个位置上的两个候选，不是两个可以各自开关的按钮。
 * 分段式按钮会让人以为两个状态可以同时存在，也会让人以为点一下是「切换开关」而不是「改选另一个」。
 *
 * 这里**没有**规则级兜底列表：一条规则命中却给不出落点时，它的语义是「这条不成立」，
 * 继续往下匹配，最后落到表级兜底 —— 少一层嵌套，顺序读下来就是全部语义。
 */
export function LandingEditor(props: LandingEditorProps) {
  const { landing, logicalModels, onChange } = props
  const t = useTranslation()

  const toggleModel = (modelId: string, checked: boolean) => {
    const next = checked
      ? [...landing.logicalModelIds.filter(id => id !== modelId), modelId]
      : landing.logicalModelIds.filter(id => id !== modelId)
    onChange({ ...landing, logicalModelIds: next })
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <RuleFieldLabel>{t('router.rules.editor.landing')}</RuleFieldLabel>
        <RadioGroup
          value={landing.source}
          aria-label={t('router.rules.editor.landing')}
          className="flex flex-wrap items-center gap-4"
          onValueChange={value => onChange({ ...landing, source: value as RouteRuleLanding['source'] })}
        >
          {LANDING_SOURCES.map(option => (
            <label key={option.value} className="flex cursor-pointer items-center gap-1.5">
              <RadioGroupItem value={option.value} />
              <span className="system-xs-regular text-text-secondary">{t(option.labelKey)}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {landing.source === 'fixed'
        ? (
          <LogicalModelPicker
            emptyHint={t('router.panel.noLogicalModels')}
            logicalModels={logicalModels}
            selectedIds={landing.logicalModelIds}
            onToggle={toggleModel}
          />
        )
        : (
          <div className="flex items-center gap-2">
            <FieldPathInput
              className="w-full max-w-80"
              value={landing.variablePath}
              ariaLabel={t('router.rules.variablePath')}
              // 占位提示语不能就是默认值本身（`request.body.model`）：默认那条规则的值就是它，
              // 于是这串字永远不会以提示的形式出现，看上去就像这一格根本没有提示。
              placeholder={t('router.rules.variablePathHint')}
              // 取到的值要当逻辑模型 id 用，所以候选只给能当 id 用的那些（口径与图侧一致）。
              hints={RULE_VARIABLE_PATH_HINTS}
              onChange={variablePath => onChange({ ...landing, variablePath })}
            />
            <span className="min-w-0 flex-1 system-xs-regular text-text-tertiary">{t('router.rules.variableHint')}</span>
          </div>
        )}
    </div>
  )
}
