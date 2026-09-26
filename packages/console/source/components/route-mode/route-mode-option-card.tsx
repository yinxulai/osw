import { Check } from 'lucide-react'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { RouteModeOption } from './route-mode-options'

export interface RouteModeOptionCardProps {
  option: RouteModeOption
  active: boolean
  switching: boolean
  onSelect: () => void
  /**
   * 紧凑形态：只留图标、名字、一句话摘要与「正在生效」角标，收起那三条逐条对齐的差异点。
   *
   * 给新手引导用。弹窗那边是「看清楚再选」，两栏逐条对着读才有意义；引导页那一刻用户连模型都还没有，
   * 先要的是「选一个，然后往下走」——把六行对比铺在首屏，读起来像是在要求他先交一份架构决定。
   * 差异点并没有消失，引导页把它放进折叠区（同一份 `traitKeys`、同一个 `RouteModeTraits`），想比的人展开就有。
   *
   * 刻意做成一个参数而不是在引导页另写一张紧凑卡片：文案、选中态、焦点态、切换中禁用这些行为
   * 一旦有第二份实现，两边迟早说得不一样。默认 `false`——弹窗不传，长相与从前逐像素一致。
   */
  compact?: boolean
}

/**
 * 一个模式的差异点清单（能表达什么 / 怎么改 / 适合什么场景）。
 *
 * 单独抽出来是因为它有两个摆法：卡片内（模式弹窗、引导页的展开区）与并排对比（引导页的折叠区）。
 * 摆法不同但**读的东西必须是同一份**，否则「引导里说的三条」和「弹窗里说的三条」会各自漂移。
 * 用 `span` 而不是 `ul`：外层是 `<label>`，标签里只允许短语内容。
 */
interface RouteModeTraitsProps {
  option: RouteModeOption
}

export function RouteModeTraits(props: RouteModeTraitsProps) {
  const t = useTranslation()

  return (
    <span className="grid gap-1.5">
      {props.option.traitKeys.map(key => (
        <span key={key} className="flex gap-1.5 system-xs-regular text-text-secondary">
          <span className="text-text-quaternary" aria-hidden>
            ·
          </span>
          {t(key)}
        </span>
      ))}
    </span>
  )
}

/**
 * 一个模式的「一栏说明」。
 *
 * 整栏就是原生 radio 的标签（隐藏输入 + 可见标签），和页头上那个控件同一个理由：
 * 两个模式天然互斥、天然单选，交给浏览器就意味着方向键切换、`aria-checked`、焦点语义全都正确，
 * 不用自己拿 `role="radio"` 拼一套只做对一半的键盘支持。
 *
 * 选中态只靠**边框 + 图标底色 + 角标**：弹窗底色本身就是白，再刷一层白块等于没画；
 * 而刷一层灰块，两栏就成了一屏里最重的两块灰 —— 层次应该由边框给，不由底色给。
 *
 * 焦点态与选中态**必须长得不一样**：这里原本用 `ring-2 ring-state-accent-solid`，
 * 那是贴着卡片边缘、和选中边框同一个颜色的一圈实线 —— 弹窗打开时 Radix 会把焦点
 * 送到第一栏（未必是生效的那一栏），于是屏幕上出现两张「被描了黑边的卡片」，
 * 谁也说不清哪个才是当前生效的。改成仓库全局那套键盘焦点写法（1px `ring`、外扩 2px），
 * 它和贴着边缘的选中边框在**形态**上就分得开：一个是描边，一个是离了一圈的细线。
 *
 * 从 `route-mode-dialog.tsx` 抽出来共享：模式弹窗与新手引导是**同一张卡片**，
 * 两处若各写一份，改文案或改选中态就得记着改两遍。
 */
export function RouteModeOptionCard(props: RouteModeOptionCardProps) {
  const { option, active, switching, onSelect, compact = false } = props
  const t = useTranslation()
  const Icon = option.icon

  return (
    <label
      className={cn(
        'flex flex-col rounded-lg border transition-colors',
        compact ? 'gap-2 p-3' : 'gap-3 p-3.5',
        'focus-within:outline-1 focus-within:outline-offset-2 focus-within:outline-ring',
        active ? 'border-state-accent-solid' : 'border-module-border hover:border-text-quaternary',
        switching ? 'cursor-progress' : 'cursor-pointer',
      )}
    >
      <input
        type="radio"
        name="route-mode"
        className="sr-only"
        value={option.value}
        checked={active}
        disabled={switching}
        aria-label={t(option.labelKey)}
        onChange={onSelect}
      />

      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
            active ? 'bg-state-accent-solid text-primary-foreground' : 'text-text-tertiary',
          )}
        >
          {switching && active ? <Spinner className="size-3.5" /> : <Icon className="size-3.5" aria-hidden />}
        </span>
        <span className="system-sm-medium text-text-primary">{t(option.labelKey)}</span>
        {/* 角标只挂在当前生效的那一栏：它是状态，不是「你选中了什么」的复述。 */}
        {active && !switching && (
          <span className="ml-auto inline-flex items-center gap-1 system-2xs-medium text-text-accent">
            <Check className="size-3" aria-hidden />
            {t('router.mode.active')}
          </span>
        )}
      </span>

      <span className="system-xs-regular text-text-tertiary">{t(option.summaryKey)}</span>

      {compact ? null : <RouteModeTraits option={option} />}
    </label>
  )
}
