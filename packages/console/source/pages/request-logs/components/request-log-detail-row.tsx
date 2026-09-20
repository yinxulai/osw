import * as React from 'react'
import { Braces, Check, ChevronRight, Copy, LoaderCircle, Route, ScrollText } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { resolveProxyOrigin } from '@common/proxy-origin'
import { formatMilliseconds, formatOutputSpeed, requestOutputTokensPerSecond, servingAttemptOf } from '@common/metrics'
import type {
  RequestContentSummary,
  RequestLogDetail,
  RequestLogEntry,
  RequestLogEntryAttempt,
  TransportKind,
} from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useProxyStatus } from '@/features/proxy/hooks'
import { useLocale, useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { routePaths } from '@/routes'
import { fetchRequestLogBodies, useRequestLogBodiesQuery } from '../queries'
import { buildCurl } from '../lib/build-curl'
import {
  PROTOCOL_LABEL,
  distinctAttemptErrorCode,
  distinctAttemptErrorMessage,
  formatAttemptOutcome,
  formatNumber,
  formatStatus,
  formatTime,
  formatTransport,
} from '../lib/format'
import { RequestContentsSheet } from './request-contents-sheet'

interface RequestLogDetailRowProps {
  log: RequestLogEntry | RequestLogDetail
  modelName: string
  detailLoading: boolean
  detailError: string | null
}
interface StatusBadgeProps {
  status: string
}

interface RequestLogIdLinkProps {
  requestId: string
}

interface CopyRequestButtonProps {
  /** 客户端视角的报文身份（方法、路径、头）。正文不在这里，点按钮时现取。 */
  content: RequestContentSummary | null
  /** 代理监听的地址，用来把记录的路径拼成可直接执行的绝对 URL。 */
  origin: string | null
}

interface ProviderRouteProps {
  attempts: RequestLogEntryAttempt[]
  /** 客户端协议；用来判断某次尝试是否发生了协议转换。 */
  clientProtocol: string | null
  /** 客户端跳声明的传输形态。**预期**：用来点出「要了增量却拿到整包」这种上游违约。 */
  transport: TransportKind
  onSelect: (attemptId: string) => void
}

interface MetricCardProps {
  label: string
  value: string
}

interface CopyIconButtonProps {
  value: string
  /** 可访问名，例如「复制请求 ID」。 */
  label: string
}

interface MetaFactProps {
  label: string
  value: string
  mono?: boolean
  tone?: 'default' | 'warning'
  /** 提供后在该事实右侧显示复制按钮。 */
  copyValue?: string
}

const RUNTIME_LOG_RETENTION_DAYS = 3
const RUNTIME_LOG_RETENTION_MS = RUNTIME_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-info/10 text-info',
  success: 'bg-success/10 text-text-success',
  failed: 'bg-destructive/10 text-text-destructive',
  cancelled: 'bg-inset text-text-tertiary',
}

export function RequestStatusBadge(props: StatusBadgeProps) {
  const t = useTranslation()
  return (
    <Badge variant="outline" className={cn('font-normal', STATUS_BADGE[props.status] ?? '')}>
      {formatStatus(t, props.status)}
    </Badge>
  )
}

/** 路由整体结论。只提炼「整条路由都失败且原因一致」的事实，避免每一行重复同一句话。 */
interface RouteSummary {
  count: number
  /** 成功尝试的下标（0 起）；全部失败时为 `null`。 */
  successIndex: number | null
  /** 全部失败且错误信息一致时归纳出的那一条；其余情况为 `null`。 */
  commonErrorMessage: string | null
}

function summarizeRoute(attempts: RequestLogEntryAttempt[]): RouteSummary {
  const successIndex = attempts.findIndex(attempt => attempt.status === 'success')
  // 重试后成功时，前面的失败只是过程而不是结论：把它的错误信息留在行内，
  // 不要提升成红字的路由摘要，否则会让人误判这次请求整体是失败的。
  const failures = successIndex >= 0 ? [] : attempts.filter(attempt => attempt.status !== 'success')
  const messages = new Set(failures.map(attempt => attempt.errorMessage ?? '').filter(Boolean))

  return {
    count: attempts.length,
    successIndex: successIndex >= 0 ? successIndex : null,
    commonErrorMessage: messages.size === 1 ? [...messages][0] : null,
  }
}

/**
 * 单个指标格。
 *
 * 只有两行：标签 + 数值。不再加第三行的补充说明——「缓存是否命中」这类上下文
 * 在请求列表和下面的「原始 Usage」里都已经有落点，在数值底下再写一遍只会稀释数字本身。
 * 空值走最淡的一档灰，让有数字的格子自己浮出来。
 */
function MetricCard(props: MetricCardProps) {
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

/**
 * 事实旁的小复制按钮。
 *
 * 复制成功的反馈留在按钮本身，不再弹 toast 打断排障视线。
 */
function CopyIconButton(props: CopyIconButtonProps) {
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

/** 摘要事实：标签 + 值成对，替代原来用 `·` 串起来的文本墙。 */
function MetaFact(props: MetaFactProps) {
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

function RequestLogIdLink(props: RequestLogIdLinkProps) {
  const t = useTranslation()

  // 「查看日志」原来是个无边框的小幽灵按钮，飘在大块留白里，与标题不成一体。
  // 改成与标题同一行的 outline 按钮，并沿用侧边栏对 `/logs` 的称呼。
  // 用 `Link` 而不是 `navigate()`：深链本身可被中键/右键新开，跳转语义正确。
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link
        to={routePaths.logs}
        search={{ q: props.requestId }}
        title={t('requestLogs.detail.viewRuntimeLogsTitle')}
        // 点击链接不应该顺带选中/展开这一行。
        onClick={event => event.stopPropagation()}
      >
        <ScrollText size={13} aria-hidden />
        {t('requestLogs.detail.viewRuntimeLogs')}
      </Link>
    </Button>
  )
}

/**
 * 「复制请求」：把客户端那次请求还原成一条可以直接粘进终端跑的 cURL。
 *
 * 正文可能有几百 KB 且包含任意字符，所以转义全部交给 `buildCurl`；
 * 这里只负责把记录的路径接上代理地址，以及与「查看日志」保持同一行、同一尺寸。
 * 没有正文记录时按钮照常占位（禁用 + 说明原因），避免详情卡头部随数据有无而跳动。
 */
function CopyRequestButton(props: CopyRequestButtonProps) {
  const t = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [copied, setCopied] = React.useState(false)
  const [copying, setCopying] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const content = props.content
  // 命令本身来自摘要（方法、路径、头），只有请求体要现取，因此没有报文行时才不可用。
  const available = content !== null && props.origin !== null
  const label = copied ? t('common.action.copied') : t('requestLogs.detail.copyRequest')
  const title = available ? t('requestLogs.detail.copyRequestTitle') : t('requestLogs.detail.copyRequestUnavailable')

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('shrink-0', copied && 'text-text-success')}
      disabled={!available || copying}
      title={title}
      aria-label={title}
      onClick={async event => {
        event.stopPropagation()
        if (!available) return
        setCopying(true)
        try {
          // 请求体不在详情里（正文按需取）。点这个按钮就是在要正文，所以就地取一次，
          // 而不是让按钮一直灰着；取回来的那份同时进缓存，正文面板直接命中。
          const bodies = await fetchRequestLogBodies(content.requestId, queryClient)
          const body = bodies.contents.find(item => item.id === content.id)?.requestBody ?? null
          const curl = buildCurl({
            url: `${props.origin}${content.requestPath}`,
            method: content.requestMethod,
            headers: content.requestHeaders,
            body,
          })
          await navigator.clipboard.writeText(curl)
          setCopied(true)
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setCopied(false), 1500)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
        } finally {
          setCopying(false)
        }
      }}
    >
      {copying ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      {label}
    </Button>
  )
}

interface AttemptRowProps {
  attempt: RequestLogEntryAttempt
  index: number
  clientProtocol: string | null
  transport: TransportKind
  summary: RouteSummary
  onSelect: (attemptId: string) => void
}

/**
 * 单次尝试一行。
 *
 * 一个结果事实只有一处落点：HTTP 状态 → 结果徽标；是否继续切换 → 「可重试」；
 * 错误码若是状态码的副本则不再出现；共同错误信息由路由顶部统一说明。
 */
function AttemptRow(props: AttemptRowProps) {
  const t = useTranslation()
  const { attempt, summary } = props
  const ok = attempt.status === 'success'
  const upstreamLabel = attempt.upstreamProtocol === null
    ? null
    : PROTOCOL_LABEL[attempt.upstreamProtocol] ?? attempt.upstreamProtocol
  // 上游协议与客户端协议一致时不必逐行重复——那是绝大多数情况，只有转换才值得标出来。
  const converted = props.clientProtocol !== null
    && attempt.upstreamProtocol !== null
    && attempt.upstreamProtocol !== props.clientProtocol
  // 完全相同的错误信息已经在路由顶部说过一次，行内只补充「与共同结论不同」的部分；
  // 与 HTTP 状态同义的「上游返回 401」也不再重复一遍。
  const message = distinctAttemptErrorMessage(attempt)
  const errorMessage = message && message !== summary.commonErrorMessage ? message : null
  const errorCode = distinctAttemptErrorCode(attempt)
  // 客户端跳与上游跳对「这份响应是不是增量」的说法不一致，是上游没兑现预期；一致时不再占用版面。
  const transportMismatch = !ok
    && attempt.upstreamTransport !== null
    && (props.transport === 'http-stream') !== (attempt.upstreamTransport === 'http-stream')

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('requestLogs.attempt.viewDetail', { index: props.index + 1 })}
      className="group grid w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto_auto_12px] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-state-accent-solid"
      title={attempt.url}
      onClick={() => props.onSelect(attempt.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect(attempt.id)
        }
      }}
    >
      <span className={cn(
        'flex size-4.5 items-center justify-center rounded font-mono system-2xs-medium',
        ok ? 'bg-success/10 text-text-success' : 'bg-destructive/10 text-text-destructive',
      )}>
        {props.index + 1}
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 system-xs-medium text-text-primary">{attempt.providerName}</span>
          <span aria-hidden className="shrink-0 text-text-quaternary">/</span>
          <span className="min-w-0 truncate font-mono system-xs-regular text-text-tertiary">{attempt.providerModelName}</span>
          {converted && upstreamLabel && (
            <Badge variant="warning" className="shrink-0 font-normal">
              {t('requestLogs.attempt.converted', { protocol: upstreamLabel })}
            </Badge>
          )}
        </div>
        {(errorMessage || errorCode) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 system-2xs-regular text-text-destructive">
            {errorCode && <span className="shrink-0 font-mono">{errorCode}</span>}
            {errorMessage && <span className="min-w-0 truncate">{errorMessage}</span>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant={ok ? 'success' : 'destructive'} className="font-normal">
          {formatAttemptOutcome(t, attempt)}
        </Badge>
        {attempt.retryable && !ok && <Badge variant="warning" className="font-normal">{t('requestLogs.attempt.retryable')}</Badge>}
        {transportMismatch && <Badge variant="warning" className="font-normal">{t('requestLogs.attempt.transportMismatch')}</Badge>}
      </div>

      <div className="shrink-0 text-right font-mono system-2xs-regular tabular-nums">
        <div className="text-text-secondary">{formatMilliseconds(attempt.durationMilliseconds)}</div>
        {attempt.ttftMilliseconds !== null && (
          <div className="text-text-quaternary">{t('requestLogs.attempt.firstToken', { value: formatMilliseconds(attempt.ttftMilliseconds) })}</div>
        )}
      </div>

      <ChevronRight
        size={12}
        aria-hidden
        className="text-text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary group-focus-visible:text-text-primary"
      />
    </div>
  )
}

function ProviderRoute(props: ProviderRouteProps) {
  const t = useTranslation()
  const summary = React.useMemo(() => summarizeRoute(props.attempts), [props.attempts])

  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="border-b border-border/50 px-3 py-2.5">
        <div className="flex items-center gap-1.5 system-sm-medium text-text-primary">
          <Route size={13} aria-hidden className="text-text-quaternary" />
          {t('requestLogs.route.title')}
        </div>
        {props.attempts.length > 0 && (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 system-2xs-regular text-text-tertiary">
            {summary.successIndex === null ? (
              <span>{t('requestLogs.route.allFailed', { count: summary.count })}</span>
            ) : (
              <>
                <span>{summary.successIndex === 0 ? t('requestLogs.route.firstSucceeded') : t('requestLogs.route.succeededAt', { index: summary.successIndex + 1 })}</span>
                {summary.count > 1 && (
                  <>
                    <span aria-hidden className="text-text-quaternary">·</span>
                    <span>{t('requestLogs.route.totalAttempts', { count: summary.count })}</span>
                  </>
                )}
              </>
            )}
            {summary.commonErrorMessage && (
              <>
                <span aria-hidden className="text-text-quaternary">·</span>
                <span className="wrap-break-word text-text-destructive">{summary.commonErrorMessage}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="divide-y divide-border/50">
        {props.attempts.map((attempt, index) => (
          <AttemptRow
            key={attempt.attemptIndex}
            attempt={attempt}
            index={index}
            clientProtocol={props.clientProtocol}
            transport={props.transport}
            summary={summary}
            onSelect={props.onSelect}
          />
        ))}
        {props.attempts.length === 0 && (
          <div className="px-3 py-6 text-center system-xs-regular text-text-tertiary">{t('requestLogs.route.noAttempts')}</div>
        )}
      </div>
    </section>
  )
}

interface RawUsageProps {
  usage: RequestLogEntry['rawUsage']
}

/**
 * 原始 Usage 原样展示。
 *
 * 没有 usage 时不给整块换一套写法：卡片、标题、在栅格里的位置全都不变，
 * 只是正文换成一句说明。否则同一张请求列表里「有用量」和「没用量」两种行长得完全不一样，
 * 上下滚动时整页都在跳。
 *
 * 副标题必须把口径写出来：这块展示的是**服务该请求的那次尝试**报回的用量，
 * 不是这个请求历次尝试用量的合并（详见 `recordAttemptUsage`）。
 */
function RawUsage(props: RawUsageProps) {
  const t = useTranslation()
  const rawUsage = props.usage ? JSON.stringify(props.usage, null, 2) : null

  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="border-b border-border/50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 system-sm-medium text-text-primary">
            <Braces size={13} aria-hidden className="text-text-quaternary" />
            {t('requestLogs.usage.title')}
          </div>
          {rawUsage && <CopyIconButton label={t('requestLogs.usage.copy')} value={rawUsage} />}
        </div>
        <div className="mt-1 system-2xs-regular text-text-tertiary">{t('requestLogs.usage.provenance')}</div>
      </div>
      {rawUsage
        ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all bg-inset p-3 font-mono system-2xs-regular text-text-secondary">{rawUsage}</pre>
        : <p className="px-3 py-3 system-xs-regular text-text-quaternary">{t('requestLogs.usage.empty')}</p>}
    </section>
  )
}

/**
 * 指标集合是固定的：没有值的指标照样占格，值显示「—」。
 *
 * 不用「有值才出现」的写法，是因为那样每次请求的格子数量和顺序都不一样，
 * 上下扫的时候数字会跑到别的列上，也没法一眼看出「哪一格是空的」——
 * 而「这里没有数」本身就是排障要知道的事。
 *
 * 口径统一到「服务该请求的那次尝试」：Token 六项与首字延迟读的都是那次尝试的值
 * （请求级用量本来就是它镜像过来的一份，`ttftMilliseconds` 也是按它现算的），
 * 所以多次重试的请求不会把历次尝试的数字加在一起。
 * 只有「总耗时」是请求级事实——客户端等的是整条链路，不是某一个候选。
 */
function buildMetrics(t: AppTranslator, log: RequestLogEntry | RequestLogDetail, tps: string): MetricCardProps[] {
  return [
    { label: t('requestLogs.metric.totalDuration'), value: formatMilliseconds(log.totalDurationMilliseconds) },
    { label: t('requestLogs.metric.ttft'), value: formatMilliseconds(log.ttftMilliseconds) },
    { label: t('requestLogs.metric.outputSpeed'), value: tps === '—' ? '—' : `${tps} t/s` },
    { label: t('requestLogs.metric.totalTokens'), value: formatNumber(log.totalTokens) },
    { label: t('requestLogs.metric.inputTokens'), value: formatNumber(log.inputTokens) },
    { label: t('requestLogs.metric.outputTokens'), value: formatNumber(log.outputTokens) },
    { label: t('requestLogs.metric.reasoningTokens'), value: formatNumber(log.reasoningTokens) },
    { label: t('requestLogs.metric.cacheRead'), value: formatNumber(log.cachedInputTokens) },
    { label: t('requestLogs.metric.cacheWrite'), value: formatNumber(log.cacheCreationInputTokens) },
  ]
}

export function RequestLogDetailRow(props: RequestLogDetailRowProps) {
  const t = useTranslation()
  const locale = useLocale()
  const proxyStatus = useProxyStatus()
  const { log, modelName } = props
  // 服务该请求的那次尝试恒为最后一次：故障转移一旦交付就停止，被放弃的尝试不会排在它后面。
  // 它是这张详情卡片全部尝试级口径的来源，也是「有成功记录时必然是那一条」的原因。
  const servingAttempt = servingAttemptOf(log)
  // 上游协议是尝试级事实：故障转移的请求可能先后朝不同协议发出过请求，
  // 头部只标出真正交付那次尝试用的是哪个上游协议，与客户端拿到什么形态的响应无关
  // （那是请求级 `transport` 与尝试级 `upstreamTransport` 说的事）。
  const upstreamProtocol = servingAttempt?.upstreamProtocol
    ?? log.attempts[0]?.upstreamProtocol
  // 速度按 `@common/metrics` 的唯一定义现算，与列表行、统计分析三处一致。
  const tps = formatOutputSpeed(requestOutputTokensPerSecond(log))
  const contents = 'contents' in log ? log.contents : null
  const requestRewriteRules = 'requestRewriteRules' in log ? log.requestRewriteRules : null
  const [selectedAttemptId, setSelectedAttemptId] = React.useState<string | null>(null)
  // 正文只在用户点开某个尝试的正文面板时才去取：它是库里最大的列，而详情在请求还挂着时
  // 每 1.5s 就被重取一次（见 issue #23）。请求落定后正文不会再变，也就不再轮询。
  const bodiesQuery = useRequestLogBodiesQuery(selectedAttemptId === null ? null : log.id, log.status === 'pending')
  const canOpenRuntimeLogs = Date.now() - log.createdTime <= RUNTIME_LOG_RETENTION_MS
  // 客户端请求的绝对地址：代理监听地址 + 记录下来的路径。拿不到监听地址就不拼，宁可禁用。
  const origin = resolveProxyOrigin(proxyStatus?.host ?? null, proxyStatus?.port ?? null)

  const clientLabel = log.clientProtocol === null
    ? t('requestLogs.detail.unrecognizedProtocol')
    : PROTOCOL_LABEL[log.clientProtocol] ?? log.clientProtocol
  // 没发生转换就不提「原生协议」——那是一句只说明「没别的事」的负向噪音。
  const converted = log.clientProtocol !== null && upstreamProtocol !== null && upstreamProtocol !== log.clientProtocol
  const protocolText = converted
    ? `${clientLabel} → ${PROTOCOL_LABEL[upstreamProtocol!] ?? upstreamProtocol}`
    : clientLabel
  const metrics = buildMetrics(t, log, tps)

  return (
    <tr className="bg-inset">
      <td colSpan={11} className="border-b border-border/40 p-0">
        <div className="bg-card px-5 py-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="system-sm-medium text-text-primary">{t('requestLogs.detail.title')}</span>
                <RequestStatusBadge status={log.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 system-2xs-regular">
                {log.logicalModelId === null
                  ? <MetaFact label={t('requestLogs.detail.logicalModel')} value={t('requestLogs.detail.unresolved')} />
                  : (
                    <>
                      <MetaFact label={t('requestLogs.detail.logicalModel')} value={modelName} />
                      {modelName !== log.logicalModelId && (
                        <MetaFact label={t('requestLogs.detail.modelId')} value={log.logicalModelId} mono />
                      )}
                    </>
                  )}
                <MetaFact
                  label={t(converted ? 'requestLogs.detail.convertedProtocol' : 'requestLogs.detail.protocol')}
                  value={protocolText}
                  tone={converted ? 'warning' : 'default'}
                />
                {/* 传输形态是客户端跳声明的预期，与上游跳实际怎么回无关。 */}
                <MetaFact label={t('requestLogs.detail.transport')} value={formatTransport(t, log.transport)} />
                <MetaFact label={t('common.label.time')} value={formatTime(locale, log.createdTime)} />
                <MetaFact label={t('requestLogs.detail.requestId')} value={log.id} mono copyValue={log.id} />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canOpenRuntimeLogs && <RequestLogIdLink requestId={log.id} />}
              <CopyRequestButton content={contents?.[0] ?? null} origin={origin} />
            </div>
          </div>

          {/* auto-fill（而非 auto-fit）：只有一两个指标有值时也让格子保持统一宽度，不被拉满整行。 */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
            {metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}
          </div>

          {/* 两栏是固定的：没有原始 Usage 时右栏也留住，只把正文换成一句说明，
              免得同一张表里两种行的版式来回跳。 */}
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
            <ProviderRoute
              attempts={log.attempts}
              clientProtocol={log.clientProtocol}
              transport={log.transport}
              onSelect={setSelectedAttemptId}
            />
            <RawUsage usage={log.rawUsage} />
          </div>
          <RequestContentsSheet
            contents={contents}
            attemptContents={'attemptContents' in log ? log.attemptContents : null}
            bodies={bodiesQuery.data ?? null}
            bodiesLoading={bodiesQuery.isPending}
            bodiesError={bodiesQuery.error === null ? null : bodiesQuery.error.message}
            attempts={log.attempts}
            requestRewriteRules={requestRewriteRules}
            clientProtocol={log.clientProtocol}
            upstreamProtocol={upstreamProtocol}
            loading={props.detailLoading}
            error={props.detailError}
            selectedAttemptId={selectedAttemptId}
            servingAttemptId={servingAttempt?.id ?? null}
            onClose={() => setSelectedAttemptId(null)}
          />
        </div>
      </td>
    </tr>
  )
}
