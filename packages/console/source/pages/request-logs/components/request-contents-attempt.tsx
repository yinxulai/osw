import * as React from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'
import type { RequestLogEntryAttempt } from '@common/schemas'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { factsOf } from '../lib/contents'
import { distinctAttemptErrorCode, distinctAttemptErrorMessage } from '../lib/format'
import { CopyButton } from './request-contents-stage'

export interface AttemptFactsProps {
  attempt: RequestLogEntryAttempt
}

/**
 * 尝试级的事实清单。
 *
 * 这些字段单独看都很小，但排障时缺任何一个都会让人回头去查库，因此整体列出：
 * 只是把「第一眼要看的」与「回头查库才用的」分成两档，后者默认收起。
 */
export function AttemptFacts(props: AttemptFactsProps) {
  const t = useTranslation()
  const locale = useLocale()
  const facts = factsOf(t, locale, props.attempt)
  const [expanded, setExpanded] = React.useState(false)
  const primary = facts.filter(fact => !fact.advanced)
  const advanced = facts.filter(fact => fact.advanced)
  const visible = expanded ? [...primary, ...advanced] : primary

  // 换一次尝试就收起来，免得上一条的展开状态串到下一条。
  React.useEffect(() => setExpanded(false), [props.attempt.id])

  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <span className="system-sm-medium text-text-primary">{t('requestLogs.contents.attemptFacts.title')}</span>
        <CopyButton
          className="ml-auto"
          label={t('requestLogs.contents.attemptFacts.copy')}
          value={facts.map(fact => t('requestLogs.contents.attemptFacts.line', { label: fact.label, value: fact.value })).join('\n')}
        />
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 px-3 py-3 md:grid-cols-2">
        {visible.map(fact => (
          <div key={fact.label} className="flex min-w-0 items-baseline gap-2 system-2xs-regular">
            <dt className="shrink-0 text-text-tertiary">{fact.label}</dt>
            <dd className="min-w-0 wrap-break-word font-mono text-text-secondary">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {advanced.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <button
            type="button"
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 system-2xs-regular text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setExpanded(value => !value)}
          >
            <ChevronDown size={12} aria-hidden className={cn('transition-transform', !expanded && '-rotate-90')} />
            {expanded ? t('requestLogs.contents.attemptFacts.collapse') : t('requestLogs.contents.attemptFacts.expand', { count: advanced.length })}
          </button>
        </div>
      )}
    </section>
  )
}

export interface AttemptErrorProps {
  attempt: RequestLogEntryAttempt
}

/**
 * 失败横幅：只报状态码之外还多出来的东西。
 *
 * HTTP 状态已经写在标题栏和「结果」里各一次，横幅再报一遍就只是重复；
 * 但错误码与错误信息是排除故障的第一手材料，值得单独一条。
 */
export function AttemptError(props: AttemptErrorProps) {
  const t = useTranslation()
  const { attempt } = props
  const code = distinctAttemptErrorCode(attempt)
  const message = distinctAttemptErrorMessage(attempt)
  if (!code && !message) return null

  const errorText = [
    attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : t('requestLogs.contents.errorBanner.title'),
    code,
    message,
  ].filter(Boolean).join('\n')

  return (
    <section className="rounded-lg border border-module-border bg-destructive/8 px-3 py-2.5 system-xs-regular">
      <div className="flex flex-wrap items-center gap-2 system-xs-medium text-text-destructive">
        <AlertCircle size={14} aria-hidden />
        {/* 有状态码时状态码已经在标题栏里，这里只补状态码之外的东西。 */}
        {attempt.httpStatus === null && <span>{t('requestLogs.contents.errorBanner.title')}</span>}
        {code && <span className="font-mono system-2xs-regular">{code}</span>}
        <CopyButton
          className="ml-auto text-text-destructive hover:text-text-destructive"
          label={t('requestLogs.contents.errorBanner.copy')}
          value={errorText}
        />
      </div>
      {message && <div className="mt-1 wrap-break-word text-text-destructive">{message}</div>}
    </section>
  )
}
