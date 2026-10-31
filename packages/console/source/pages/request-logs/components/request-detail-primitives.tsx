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

/**
 * 单个指标格已经升到 `@/components/metric-card`。
 *
 * 它原先只服务请求详情，现在诊断明细也要用同一种格子——两个页面的卡片里装同一种
 * 嵌套模块，样式各写一份只会在尺寸上分岔。这里保留这层转出，是因为请求详情的
 * 「公共零件」入口已经是一个稳定概念：调用方找的是「请求详情的格子」，不必知道
 * 它住在哪一层。
 */
export { MetricCard, type MetricCardProps } from '@/components/metric-card'

export { METRIC_CARD_GRID_CLASS } from '@/components/metric-card'

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

export interface AppliedRule {
  /** 稳定 key；实时侧没有规则 id 时由调用方按出现位置构造。 */
  key: string
  name: string
}

interface AppliedRulesProps {
  rules: readonly AppliedRule[]
}

/** 请求阶段实际命中的修改器。实时与落库详情共用同一种读法。 */
export function AppliedRules(props: AppliedRulesProps) {
  const t = useTranslation()
  if (props.rules.length === 0) return null

  return (
    <section className="rounded-lg border border-module-border bg-info/8 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="system-xs-medium text-text-primary">{t('requestLogs.contents.appliedRules.title')}</span>
        <CopyIconButton
          label={t('requestLogs.contents.appliedRules.copy')}
          value={props.rules.map(rule => rule.name).join('\n')}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {props.rules.map(rule => (
          <span key={rule.key} className="rounded-md bg-info/15 px-1.5 py-0.5 system-2xs-medium text-info">
            {rule.name}
          </span>
        ))}
      </div>
    </section>
  )
}

export interface MetaFactProps {
  label: string
  value: string
  mono?: boolean
  tone?: 'default' | 'warning'
  /** 提供后在该事实右侧显示复制按钮。 */
  copyValue?: string
  /** 值是省略过的形式时，把原文挂在这里当悬停提示。 */
  title?: string
  /** 值旁边的一枚小标签（例如「已删除」），说明这个事实此刻的状态。 */
  tag?: React.ReactNode
}

/** 摘要事实：标签 + 值成对，一眼看得出哪段是标签、哪段是值。 */
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
        title={props.title}
      >
        {props.value}
      </span>
      {props.tag}
      {props.copyValue && <CopyIconButton label={t('requestLogs.detail.copyLabel', { label: props.label })} value={props.copyValue} />}
    </span>
  )
}
