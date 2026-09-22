import * as React from 'react'
import { Check, Copy, type LucideIcon } from 'lucide-react'
import { InfoHint } from '@/components/info-hint'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

/**
 * 请求详情的公共零件。
 *
 * 「请求详情」与「请求执行详情」是请求列表里展开区的两种类型，前者读落库的记录、
 * 后者读代理内存里的台账，但它们必须**长得像同一种东西**：同一条请求从执行中变成已完成，
 * 展开区里的分块、标题、指标格的尺寸不该跟着变，否则每次落定都像换了一个页面。
 *
 * 所以分块外壳、指标格、事实对、复制按钮都收在这里，两边共用。改动这里等于同时改两种详情。
 */

export interface DetailSectionProps {
  icon: LucideIcon
  title: string
  /**
   * 口径说明：这块展示的是哪一次尝试、这条结论是怎么归纳出来的。
   *
   * 它挂在标题旁的 info 图标上，**不占正文一行**——口径不是数据，固定在标题底下写一行，
   * 每个展开的人每次都要绕过它；收进悬停之后，默认视图只剩标题与内容。
   */
  info?: string
  /** 标题右侧的按钮或读数。 */
  action?: React.ReactNode
  children: React.ReactNode
}

/** 详情里的一个分块：边框圈起来，标题栏只有白底与一条底部分隔线。 */
export function DetailSection(props: DetailSectionProps) {
  const Icon = props.icon
  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="border-b border-border/50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 system-sm-medium text-text-primary">
            <Icon size={13} aria-hidden className="text-text-quaternary" />
            {props.title}
            {props.info !== undefined && <InfoHint text={props.info} />}
          </div>
          {props.action}
        </div>
      </div>
      {props.children}
    </section>
  )
}

export interface MetricCardProps {
  label: string
  value: string
}

/**
 * 单个指标格。
 *
 * 只有两行：标签 + 数值。不再加第三行的补充说明——「缓存是否命中」这类上下文
 * 在请求列表和下面的「原始 Usage」里都已经有落点，在数值底下再写一遍只会稀释数字本身。
 * 空值走最淡的一档灰，让有数字的格子自己浮出来。
 */
export function MetricCard(props: MetricCardProps) {
  // 指标块是请求详情卡片里的嵌套模块：只留边框，不再铺一层灰底。
  const empty = props.value === '—'

  return (
    <div className="rounded-lg border border-module-border px-3 py-2.5">
      <div className="system-2xs-medium-uppercase tracking-wider text-text-tertiary">{props.label}</div>
      <div className={cn('mt-1 font-mono system-md-medium tabular-nums', empty ? 'text-text-quaternary' : 'text-text-primary')}>
        {props.value}
      </div>
    </div>
  )
}

interface CopyIconButtonProps {
  value: string
  /** 可访问名，例如「复制请求 ID」。 */
  label: string
}

/**
 * 事实旁的小复制按钮。
 *
 * 复制成功的反馈留在按钮本身，不再弹 toast 打断排障视线。
 */
export function CopyIconButton(props: CopyIconButtonProps) {
  const t = useTranslation()
  const toast = useToast()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return (
    <button
      type="button"
      aria-label={copied ? t('common.action.copied') : props.label}
      title={copied ? t('common.action.copied') : props.label}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        copied && 'text-text-success',
      )}
      onClick={async event => {
        event.stopPropagation()
        try {
          await navigator.clipboard.writeText(props.value)
          setCopied(true)
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setCopied(false), 1500)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
        }
      }}
    >
      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
    </button>
  )
}

export interface MetaFactProps {
  label: string
  value: string
  mono?: boolean
  tone?: 'default' | 'warning'
  /** 提供后在该事实右侧显示复制按钮。 */
  copyValue?: string
}

/** 摘要事实：标签 + 值成对，替代原来用 `·` 串起来的文本墙。 */
export function MetaFact(props: MetaFactProps) {
  const t = useTranslation()
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-text-quaternary">{props.label}</span>
      <span
        className={cn(
          'min-w-0 truncate',
          props.mono && 'font-mono',
          props.tone === 'warning' ? 'text-text-warning' : 'text-text-secondary',
        )}
      >
        {props.value}
      </span>
      {props.copyValue && <CopyIconButton label={t('requestLogs.detail.copyLabel', { label: props.label })} value={props.copyValue} />}
    </span>
  )
}
