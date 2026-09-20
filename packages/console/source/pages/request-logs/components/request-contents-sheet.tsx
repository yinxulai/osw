import * as React from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Copy, LoaderCircle, Search } from 'lucide-react'
import type { AppliedRequestRewriteRule, AttemptContent, AttemptContentSummary, RequestContent, RequestContentSummary, RequestLogBodies, RequestLogEntryAttempt } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { useLocale, useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { searchBlocks, type ContentSearchResult, type SectionHighlight } from '../lib/content-search'
import { formatContent, isLocalFailureBody } from '../lib/format-content'
import { PROTOCOL_LABEL, distinctAttemptErrorCode, distinctAttemptErrorMessage, formatAttemptOutcome, formatTransport } from '../lib/format'

interface ContentSectionProps {
  id: string
  label: string
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 命中高亮；没有搜索词时为 `null`，此时整段按普通文本渲染。 */
  highlight: SectionHighlight | null
  /** 当前激活的命中序号（全局），用于定位与强调。 */
  activeMatchIndex: number | null
}

interface CopyButtonProps {
  value: string
  /** 可访问名，例如「复制请求 Body」。 */
  label: string
  className?: string
}

interface RequestStageSection {
  id: string
  label: string
  value: string | null
}

interface RequestStageProps {
  title: string
  /** 已经本地化的协议名。 */
  protocol: string
  /** 该阶段的响应状态；`null` 表示该阶段没有可展示的状态（如尚未拿到正文）。 */
  statusLabel: string | null
  /**
   * 这条视角的正文记录没有采全（`captureStatus === 'partial'`）。
   *
   * 只给响应阶段置位：请求体在响应头到达之前就已经发完了，「半截」只可能出现在响应上。
   * 行级状态挂在响应当头，既不会一行说两遍，也不会让人误读成请求体被截断。
   */
  partialCapture?: boolean
  sections: RequestStageSection[]
  sectionStates: Record<string, boolean>
  onSectionOpenChange: (id: string, open: boolean) => void
  search: ContentSearchResult
  /** 当前激活的命中序号（全局）；没有搜索词时为 `null`。 */
  activeMatchIndex: number | null
  /**
   * 正文整体缺失（被保留策略清掉，或采集开关当时是关的）。
   *
   * 此时四个阶段全部没有任何可展示的正文。不再整块隐藏——那会让人以为界面坏了，
   * 而且和「有正文的请求」长得完全不一样；改成照旧画出来，里面用 `—` 占位。
   */
  empty: boolean
}

interface AppliedRulesProps {
  ruleIds: string[]
  rules: AppliedRequestRewriteRule[] | null
}

interface AttemptErrorProps {
  attempt: RequestLogEntryAttempt
}

interface RequestContentsSheetProps {
  /** 客户端视角正文摘要；每个请求至多一行。只有报文身份，没有正文。 */
  contents: RequestContentSummary[] | null
  /** 上游视角正文摘要；每次尝试至多一行。只有报文身份，没有正文。 */
  attemptContents: AttemptContentSummary[] | null
  /** 按需取回的正文；用户没点开面板、或还在路上时为 `null`。 */
  bodies: RequestLogBodies | null
  /** 正文还在取。摘要可能早就到了，但面板一次只画一种状态，避免先闪一版空版面。 */
  bodiesLoading: boolean
  bodiesError: string | null
  attempts: RequestLogEntryAttempt[]
  requestRewriteRules: AppliedRequestRewriteRule[] | null
  /** 客户端协议；`null` 表示该请求连 API 路径都未识别。 */
  clientProtocol: string | null
  upstreamProtocol?: string | null
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  /**
   * 真正把响应写回客户端的那次尝试；`null` 表示这次请求没有任何尝试。
   *
   * 客户端跳在整条请求上只有一条出口，而且**最多只写一次**：它只属于
   * `servingAttemptOf(log)`（尝试顺序里的最后一条）。这条事实必须由外面传进来，
   * 面板自己只能看到「选中了哪次尝试」，猜不出谁交付过。
   */
  servingAttemptId: string | null
  onClose: () => void
}

function sectionKey(title: string, label: string) {
  return `${title}::${label}`
}

/** 协议枚举值转展示名；`null` 表示这次请求根本没识别出该协议。 */
function protocolLabel(t: AppTranslator, protocol: string | null): string {
  if (protocol === null) return t('requestLogs.contents.unknownProtocol')
  return PROTOCOL_LABEL[protocol] ?? protocol
}

interface AttemptFactsProps {
  attempt: RequestLogEntryAttempt
}

interface FactItem {
  label: string
  value: string
  /** 内部 id、URL、规则 id 这类只在深挖时才看的事实，默认收进「更多事实」。 */
  advanced?: boolean
}

/** 时间戳是事实本身，展示时才变成可读时间；格式化跟随界面语言。 */
function formatCreatedTime(locale: string, time: number): string {
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? String(time) : date.toLocaleString(locale, { hour12: false })
}

/**
 * 尝试级事实。
 *
 * 前面几项是排障第一眼就要看的结论与性能；内部 id、URL、规则 id 是回头查库才用到的，
 * 列为「更多事实」，默认收起。错误码/错误信息也放在收起区：它们已经由顶部横幅预告过一次，
 * 这里只是为了让「复制本次尝试事实」拿到完整记录。
 *
 * 不再列「结果」：`SheetTitle` 里的结果 chip 就紧挨在上面，写两遍只是同义反复。
 */
function factsOf(t: AppTranslator, locale: string, attempt: RequestLogEntryAttempt): FactItem[] {
  const errorCode = distinctAttemptErrorCode(attempt)
  const errorMessage = distinctAttemptErrorMessage(attempt)

  return [
    { label: t('requestLogs.contents.fact.provider'), value: attempt.providerName },
    { label: t('requestLogs.contents.fact.providerModel'), value: attempt.providerModelName },
    { label: t('requestLogs.contents.fact.upstreamProtocol'), value: attempt.upstreamProtocol ?? t('requestLogs.contents.fact.unrecognized') },
    { label: t('requestLogs.contents.fact.upstreamTransport'), value: formatTransport(t, attempt.upstreamTransport) },
    { label: t('requestLogs.contents.fact.ttft'), value: attempt.ttftMilliseconds === null ? t('requestLogs.contents.fact.noOutput') : `${attempt.ttftMilliseconds} ms` },
    { label: t('requestLogs.contents.fact.duration'), value: `${attempt.durationMilliseconds} ms` },
    { label: t('requestLogs.contents.fact.retryable'), value: attempt.retryable ? t('common.state.yes') : t('common.state.no') },
    ...(errorCode ? [{ label: t('requestLogs.contents.fact.errorCode'), value: errorCode, advanced: true }] : []),
    ...(errorMessage ? [{ label: t('requestLogs.contents.fact.errorMessage'), value: errorMessage, advanced: true }] : []),
    { label: t('requestLogs.contents.fact.attemptIndex'), value: String(attempt.attemptIndex + 1), advanced: true },
    { label: t('requestLogs.contents.fact.attemptId'), value: attempt.id, advanced: true },
    { label: t('requestLogs.contents.fact.providerId'), value: attempt.providerId, advanced: true },
    { label: t('requestLogs.contents.fact.providerModelId'), value: attempt.providerModelId, advanced: true },
    { label: t('requestLogs.contents.fact.upstreamRequestId'), value: attempt.upstreamRequestId ?? t('common.state.none'), advanced: true },
    { label: t('requestLogs.contents.fact.upstreamUrl'), value: attempt.url, advanced: true },
    { label: t('requestLogs.contents.fact.requestRewriteRules'), value: attempt.requestRewriteRuleIds.join(', ') || t('common.state.none'), advanced: true },
    { label: t('requestLogs.contents.fact.responseRewriteRules'), value: attempt.responseRewriteRuleIds.join(', ') || t('common.state.none'), advanced: true },
    { label: t('requestLogs.contents.fact.createdTime'), value: formatCreatedTime(locale, attempt.createdTime), advanced: true },
  ]
}

/**
 * 复制按钮。
 *
 * 每个内容块自带一个，只复制该块展示出来的文本：用户看到什么就拿到什么，
 * 不需要自己去拼上下文。复制成功的反馈放在按钮上，不再弹 toast 干扰排障视线。
 */
function CopyButton(props: CopyButtonProps) {
  const t = useTranslation()
  const toast = useToast()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? t('common.action.copied') : props.label}
      title={copied ? t('common.action.copied') : props.label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        copied && 'text-text-success',
        props.className,
      )}
      onClick={event => {
        // 这个按钮可能与可折叠标题相邻，避免顺带触发展开 / 收起。
        event.stopPropagation()
        void copy()
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

/**
 * 尝试级的事实清单。
 *
 * 这些字段单独看都很小，但排障时缺任何一个都会让人回头去查库，因此整体列出：
 * 只是把「第一眼要看的」与「回头查库才用的」分成两档，后者默认收起。
 */
function AttemptFacts(props: AttemptFactsProps) {
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

function ContentSection(props: ContentSectionProps) {
  const t = useTranslation()
  const content = formatContent(t, props.value)
  const segments = props.highlight?.segments ?? [{ text: content.value, matchIndex: null }]
  const matchCount = props.highlight?.count ?? 0

  // 内容块自身不再给底色：它已经是「阶段外壳」里的一个分节，再套一层白底
  // 就会在白色 Sheet 上变成看不见的白块。分节靠外壳的 border 与父级 divide-y 划分，
  // 整条链路只保留代码正文这一层凹槽（bg-inset）。
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      {/* 标题行拆成「折叠触发器 + 复制按钮」两个兄弟节点：按钮嵌在按钮里不合法，
          而拆开后拖动复制不会顺带折叠这块正文。 */}
      <div className="flex items-center transition-colors hover:bg-state-base-hover">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left system-xs-medium text-text-primary">
          <span className="truncate">{props.label}</span>
          {content.isJson && <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-regular text-text-tertiary">JSON</span>}
          {matchCount > 0 && (
            <span className="shrink-0 rounded-md bg-amber-300/70 px-1.5 py-0.5 font-mono system-2xs-regular text-text-primary dark:bg-amber-400/25">
              {t('requestLogs.contents.matchCount', { count: matchCount })}
            </span>
          )}
          <ChevronDown size={15} aria-hidden className={cn('ml-auto shrink-0 text-text-quaternary transition-transform', !props.open && '-rotate-90')} />
        </CollapsibleTrigger>
        <CopyButton className="mr-1.5" label={t('requestLogs.contents.copyLabel', { label: props.label })} value={content.value} />
      </div>
      <CollapsibleContent>
        <pre className="mx-3 mb-3 whitespace-pre-wrap break-all rounded-md bg-inset p-3 font-mono text-xs leading-5 text-text-secondary">
          {segments.map((segment, index) => segment.matchIndex === null
            ? <React.Fragment key={index}>{segment.text}</React.Fragment>
            : (
              <mark
                key={index}
                data-search-match={segment.matchIndex}
                className={cn(
                  'rounded-sm',
                  segment.matchIndex === props.activeMatchIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-amber-300/70 text-text-primary dark:bg-amber-400/30',
                )}
              >
                {segment.text}
              </mark>
            ))}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AppliedRules(props: AppliedRulesProps) {
  const t = useTranslation()
  if (props.ruleIds.length === 0) return null
  const ruleNames = new Map(props.rules?.map(rule => [rule.id, rule.name]) ?? [])
  // 规则名可能重复，因此展示按 id 去重、复制按名字拼接。
  const appliedRules = props.ruleIds.map(id => ({ id, name: ruleNames.get(id) ?? id }))

  // `bg-info/8` 在亮色下叠白后几乎不可见，因此和 `AttemptFacts` 一样补一圈模块边框，
  // 让「已应用修改器」明确成块。
  return (
    <section className="rounded-lg border border-module-border bg-info/8 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="system-xs-medium text-text-primary">{t('requestLogs.contents.appliedRules.title')}</span>
        <CopyButton className="ml-auto" label={t('requestLogs.contents.appliedRules.copy')} value={appliedRules.map(rule => rule.name).join('\n')} />
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {appliedRules.map(rule => <span key={rule.id} className="rounded-md bg-info/15 px-1.5 py-0.5 system-2xs-medium text-info">{rule.name}</span>)}
      </div>
    </section>
  )
}

function RequestStage(props: RequestStageProps) {
  const t = useTranslation()
  const sections = props.sections.filter(section => section.value)
  // 正文整体缺失时仍然把阶段画出来（见 `empty`），其余情况没有内容就不占版面。
  if (sections.length === 0 && !props.empty) return null

  // 阶段是这条链路上唯一的一层「外壳」：只留边框，不再铺灰底。
  // 铺灰底会和 Sheet 的 bg-card 形成「白 → 灰 → 白 → 灰」的交替填充，
  // 而白 100% 与灰 92% 只差 8 点明度，边界几乎看不见，整屏就糊成一片。
  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5 system-sm-medium text-text-primary">
        <span>{props.title}</span>
        <span className="font-mono system-xs-regular text-text-tertiary">· {props.protocol}</span>
        {(props.statusLabel || props.partialCapture) && (
          /* 两个尾部徽标合成一个右对齐组：状态码并不是总有（如上游一个字节都没回），
             各自带 `ml-auto` 会让「谁在右边」随数据有无而变。 */
          <div className="ml-auto flex items-center gap-1.5">
            {props.statusLabel && (
              <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-regular text-text-tertiary">
                {props.statusLabel}
              </span>
            )}
            {props.partialCapture && (
              /* 徽标本身就是悬停靶点：不再另加一个 info 图标——多一个图标反而要人先猜到它能点。 */
              <Tooltip>
                <TooltipTrigger className="rounded-md bg-warning/10 px-1.5 py-0.5 system-2xs-medium text-text-warning transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                  {t('requestLogs.contents.capture.partial')}
                </TooltipTrigger>
                <TooltipContent side="top">{t('requestLogs.contents.capture.partialHint')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      <div className="divide-y divide-border/50">
        {sections.length === 0
          ? props.sections.map(section => (
            <div key={section.id} className="flex items-center gap-2 px-3 py-2.5 system-xs-regular">
              <span className="text-text-tertiary">{section.label}</span>
              <span className="ml-auto font-mono text-text-quaternary">—</span>
            </div>
          ))
          : sections.map(section => (
            <ContentSection
              key={section.id}
              id={section.id}
              label={section.label}
              value={section.value!}
              open={props.sectionStates[section.id] ?? true}
              onOpenChange={open => props.onSectionOpenChange(section.id, open)}
              highlight={props.search.highlights.get(section.id) ?? null}
              activeMatchIndex={props.activeMatchIndex}
            />
          ))}
      </div>
    </section>
  )
}

function AttemptError(props: AttemptErrorProps) {
  const t = useTranslation()
  const { attempt } = props
  // 只有真正多出信息量的错误码/错误信息才值得这条横幅：
  // HTTP 状态已经写在标题栏和「结果」里各一次，横幅再报一遍就只是重复。
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

type RequestStageData = Omit<RequestStageProps, 'sectionStates' | 'onSectionOpenChange' | 'search' | 'activeMatchIndex' | 'empty'>

type RequestStageBuilderInput = {
  /** 客户端视角正文。 */
  clientContent: RequestContent | null
  /** 选中尝试对应的上游视角正文。 */
  attemptContent: AttemptContent | null
  /** 本次尝试的客户端协议；未知时为 `null`。 */
  clientProtocol: string | null
  /** 本次尝试实际发往上游的协议。 */
  upstreamProtocol: string | null
  /** 客户端协议与上游协议不一致，即发生过协议转换。 */
  converted: boolean
  /**
   * 选中的这次尝试是否就是把响应写回客户端的那一次。
   *
   * 为假表示这次尝试被放弃了（`servesRequest: false`）：它一个字节都没有交给客户端，
   * 因此「返回客户端的响应」这个阶段根本不属于它。
   */
  servesClient: boolean
}

function buildRequestStages(t: AppTranslator, input: RequestStageBuilderInput): RequestStageData[] {
  const { clientContent, attemptContent, clientProtocol, upstreamProtocol, converted, servesClient } = input
  const clientLabel = protocolLabel(t, clientProtocol)
  const upstreamLabel = protocolLabel(t, upstreamProtocol)
  const clientRequestTitle = t('requestLogs.contents.stage.clientRequest')
  const upstreamRequestTitle = t(converted ? 'requestLogs.contents.stage.upstreamRequestConverted' : 'requestLogs.contents.stage.upstreamRequest')
  const upstreamResponseTitle = t('requestLogs.contents.stage.upstreamResponse')
  const clientResponseTitle = t(converted ? 'requestLogs.contents.stage.clientResponseConverted' : 'requestLogs.contents.stage.clientResponse')
  // 本地失败时上游一个字节都没回。这条正文记的是本地观察到的失败原因，
  // 叫它「上游响应」会让人以为是上游回的内容。
  const upstreamResponseBodyIsLocalFailure = isLocalFailureBody(attemptContent?.responseBody ?? null)

  // 阶段的取值直接来自它所属的表：
  //   客户端原始请求 / 返回客户端的响应 -> request_contents（客户端视角）
  //   发送到供应商的请求 / 供应商响应   -> attempt_contents（上游视角）
  const stages: RequestStageData[] = [
    {
      title: clientRequestTitle,
      protocol: clientLabel,
      statusLabel: null,
      sections: [
        { id: sectionKey(clientRequestTitle, t('requestLogs.contents.section.requestHeader', { protocol: clientLabel })), label: t('requestLogs.contents.section.requestHeader', { protocol: clientLabel }), value: clientContent?.requestHeaders ?? null },
        { id: sectionKey(clientRequestTitle, t('requestLogs.contents.section.requestBody', { protocol: clientLabel })), label: t('requestLogs.contents.section.requestBody', { protocol: clientLabel }), value: clientContent?.requestBody ?? null },
      ],
    },
    {
      title: upstreamRequestTitle,
      protocol: upstreamLabel,
      statusLabel: null,
      sections: [
        { id: sectionKey(upstreamRequestTitle, t('requestLogs.contents.section.requestHeader', { protocol: upstreamLabel })), label: t('requestLogs.contents.section.requestHeader', { protocol: upstreamLabel }), value: attemptContent?.requestHeaders ?? null },
        { id: sectionKey(upstreamRequestTitle, t('requestLogs.contents.section.requestBody', { protocol: upstreamLabel })), label: t('requestLogs.contents.section.requestBody', { protocol: upstreamLabel }), value: attemptContent?.requestBody ?? null },
      ],
    },
    {
      title: upstreamResponseTitle,
      protocol: upstreamLabel,
      statusLabel: attemptContent
        ? (attemptContent.responseStatus === null ? t('requestLogs.contents.status.upstreamNoResponse') : `HTTP ${attemptContent.responseStatus}`)
        : null,
      partialCapture: attemptContent?.captureStatus === 'partial',
      sections: [
        { id: sectionKey(upstreamResponseTitle, t('requestLogs.contents.section.responseHeader', { protocol: upstreamLabel })), label: t('requestLogs.contents.section.responseHeader', { protocol: upstreamLabel }), value: attemptContent?.responseHeaders ?? null },
        {
          id: sectionKey(upstreamResponseTitle, t('requestLogs.contents.section.responseBody', { protocol: upstreamLabel })),
          label: upstreamResponseBodyIsLocalFailure
            ? t('requestLogs.contents.section.localFailure')
            : t('requestLogs.contents.section.responseBody', { protocol: upstreamLabel }),
          value: attemptContent?.responseBody ?? null,
        },
      ],
    },
  ]

  // 「返回客户端的响应」是请求级事实，不属于每一次尝试：被放弃的尝试从来没有向客户端
  // 写出过一个字节（`attempt-conclusion.ts` 里 `servesRequest: false`）。
  // 无条件拼出这一阶段，等于把**最后一次尝试**的响应记在前面几次头上——既是错误的
  // 失败归因，也让搜索与复制混进不属于这次尝试的正文。
  if (servesClient) {
    stages.push({
      title: clientResponseTitle,
      protocol: clientLabel,
      statusLabel: clientContent
        ? (clientContent.responseStatus === null ? t('requestLogs.contents.status.noResponse') : `HTTP ${clientContent.responseStatus}`)
        : null,
      partialCapture: clientContent?.captureStatus === 'partial',
      sections: [
        { id: sectionKey(clientResponseTitle, t('requestLogs.contents.section.responseHeader', { protocol: clientLabel })), label: t('requestLogs.contents.section.responseHeader', { protocol: clientLabel }), value: clientContent?.responseHeaders ?? null },
        { id: sectionKey(clientResponseTitle, t('requestLogs.contents.section.responseBody', { protocol: clientLabel })), label: t('requestLogs.contents.section.responseBody', { protocol: clientLabel }), value: clientContent?.responseBody ?? null },
      ],
    })
  }

  return stages
}

export function RequestContentsSheet(props: RequestContentsSheetProps) {
  const t = useTranslation()
  const selectedAttempt = props.attempts.find(attempt => attempt.id === props.selectedAttemptId) ?? null
  // 摘要在详情里（随行一起到达），正文在 `bodies` 里（点开面板才取），两者按 `id`
  // 对齐后才是渲染需要的一整行。对齐失败只可能是「正文还没取到」，落 `null`；
  // 那时整个面板被加载态挡着，不会把「还没取」画成「没采到」。
  const attemptSummary = props.attemptContents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  const attemptBody = props.bodies?.attemptContents.find(content => content.id === attemptSummary?.id) ?? null
  const attemptContent: AttemptContent | null = attemptSummary === null ? null : {
    ...attemptSummary,
    requestBody: attemptBody?.requestBody ?? null,
    responseBody: attemptBody?.responseBody ?? null,
  }
  // 客户端视角每个请求只有一行，不需要按 attemptId 筛选。
  const clientSummary = props.contents?.[0] ?? null
  const clientBody = props.bodies?.contents.find(content => content.id === clientSummary?.id) ?? null
  const clientContent: RequestContent | null = clientSummary === null ? null : {
    ...clientSummary,
    requestBody: clientBody?.requestBody ?? null,
    responseBody: clientBody?.responseBody ?? null,
  }
  const [search, setSearch] = React.useState('')
  const [sectionStates, setSectionStates] = React.useState<Record<string, boolean>>({})
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  // 「发生过协议转换」不是独立事实：客户端协议与本次尝试的上游协议不同即为转换。
  const clientProtocol = props.clientProtocol
  const upstreamProtocol = selectedAttempt?.upstreamProtocol ?? null
  const converted = clientProtocol !== null && upstreamProtocol !== null && clientProtocol !== upstreamProtocol
  // 客户端跳只写一次，而且只可能由服务该请求的那次尝试写出，因此这里只做身份比对。
  const servesClient = props.selectedAttemptId !== null && props.selectedAttemptId === props.servingAttemptId

  const stages = React.useMemo<RequestStageData[]>(() => buildRequestStages(t, {
    clientContent,
    attemptContent,
    clientProtocol,
    upstreamProtocol,
    converted,
    servesClient,
  }), [t, clientContent, attemptContent, clientProtocol, upstreamProtocol, converted, servesClient])

  const sections = React.useMemo(
    () => stages.flatMap(stage => stage.sections).filter(section => section.value !== null),
    [stages],
  )

  // 搜索的是「界面上真正展示的那段文本」，而 JSON 展开、流式拼回都会改变正文，
  // 所以先过一遍 formatContent，确保高亮位置和渲染出来的字符一一对应。
  const searchResult = React.useMemo(
    () => searchBlocks(sections.map(section => ({ id: section.id, text: formatContent(t, section.value!).value })), search),
    [t, sections, search],
  )
  const totalMatches = searchResult.matches.length
  const searchQuery = search.trim()

  React.useEffect(() => {
    // 切换 attempt 就清空搜索与展开态。两个 setter 都先比对再写：
    // 写 `{}` 这种新对象即使内容一样也会被判定为新 state，白白多一轮重渲染。
    setSearch(current => (current === '' ? current : ''))
    setSectionStates(current => (Object.keys(current).length === 0 ? current : {}))
  }, [props.selectedAttemptId])

  // 换一个搜索词就回到第一条命中，并把有命中的块展开；
  // 否则高亮会藏在折叠标题底下，而用户看不到任何反应。
  React.useEffect(() => {
    setActiveMatchIndex(current => (current === 0 ? current : 0))
    const matchedIds = new Set(searchResult.matches.map(match => match.sectionId))
    if (matchedIds.size === 0) return
    setSectionStates(current => {
      let changed = false
      const next = { ...current }
      matchedIds.forEach(id => {
        if (!next[id]) {
          next[id] = true
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [searchResult])

  // 命中所在的块可能刚刚被展开才挂到 DOM 上，因此 sectionStates 变化也要重新定位。
  React.useEffect(() => {
    if (totalMatches === 0) return
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [activeMatchIndex, totalMatches, sectionStates])

  const jumpToMatch = (delta: number) => {
    if (totalMatches === 0) return
    const next = (activeMatchIndex + delta + totalMatches) % totalMatches
    const sectionId = searchResult.matches[next]?.sectionId
    // 手动折叠过的块，定位到它时要先展开。
    if (sectionId) setSectionStates(current => (current[sectionId] ? current : { ...current, [sectionId]: true }))
    setActiveMatchIndex(next)
  }

  const visibleSectionIds = sections.map(section => section.id)
  // 一条正文都没有：被保留策略清掉了，或采集正文的开关一直是关的。
  // 这两种情况在数据上无法区分（都是「没有行」），因此只说事实、不猜原因。
  const bodiesMissing = sections.length === 0

  let state: React.ReactNode
  const error = props.error ?? props.bodiesError
  if (props.loading || props.bodiesLoading) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 system-sm-regular text-text-tertiary">
        <LoaderCircle size={15} aria-hidden className="animate-spin" />
        {t('requestLogs.contents.loading')}
      </div>
    )
  } else if (error) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 system-sm-regular text-text-destructive">
        <AlertCircle size={15} aria-hidden />
        {error}
      </div>
    )
  } else if (selectedAttempt || clientContent) {
    state = (
      <div className="flex h-full min-h-0 flex-col">
        <div className="sticky top-0 z-10 bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
              <Input
                aria-label={t('requestLogs.contents.searchAria')}
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  jumpToMatch(event.shiftKey ? -1 : 1)
                }}
                placeholder={t('requestLogs.contents.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            {searchQuery && (
              <span
                aria-live="polite"
                className="shrink-0 font-mono system-2xs-regular tabular-nums text-text-tertiary"
              >
                {totalMatches === 0 ? t('requestLogs.contents.noMatch') : `${activeMatchIndex + 1}/${totalMatches}`}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('requestLogs.contents.previousMatch')}
              title={t('requestLogs.contents.previousMatchTitle')}
              disabled={totalMatches === 0}
              onClick={() => jumpToMatch(-1)}
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('requestLogs.contents.nextMatch')}
              title={t('requestLogs.contents.nextMatchTitle')}
              disabled={totalMatches === 0}
              onClick={() => jumpToMatch(1)}
            >
              <ChevronDown size={14} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={visibleSectionIds.length === 0}
              onClick={() => setSectionStates(current => {
                const next = { ...current }
                visibleSectionIds.forEach(id => { next[id] = true })
                return next
              })}
            >
              {t('requestLogs.contents.expandAll')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={visibleSectionIds.length === 0}
              onClick={() => setSectionStates(current => {
                const next = { ...current }
                visibleSectionIds.forEach(id => { next[id] = false })
                return next
              })}
            >
              {t('requestLogs.contents.collapseAll')}
            </Button>
          </div>
        </div>
        <div ref={contentRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-3">
          {selectedAttempt && <AttemptError attempt={selectedAttempt} />}
          {selectedAttempt && <AttemptFacts attempt={selectedAttempt} />}
          <AppliedRules ruleIds={selectedAttempt ? [...selectedAttempt.requestRewriteRuleIds, ...selectedAttempt.responseRewriteRuleIds] : []} rules={props.requestRewriteRules} />
          {searchQuery && totalMatches === 0 && (
            <div className="rounded-md border border-module-border bg-inset px-3 py-2 system-xs-regular text-text-tertiary">
              {t('requestLogs.contents.noMatchHint', { query: searchQuery })}
            </div>
          )}
          {bodiesMissing && (
            <div className="rounded-md border border-dashed border-module-border px-3 py-2 system-xs-regular text-text-tertiary">
              {t('requestLogs.contents.pruned')}
            </div>
          )}
          {stages.map(stage => (
            <RequestStage
              key={stage.title}
              {...stage}
              sectionStates={sectionStates}
              onSectionOpenChange={(id, open) => setSectionStates(current => ({ ...current, [id]: open }))}
              search={searchResult}
              activeMatchIndex={searchQuery && totalMatches > 0 ? activeMatchIndex : null}
              empty={bodiesMissing}
            />
          ))}
          {/* 该阶段被隐藏的地方要留一句解释：否则「少了第四个阶段」既可能被读成界面出错，
              也可能被读成「正文丢了」（那由上面的 `pruned` 负责说明）。 */}
          {selectedAttempt && !servesClient && (
            <div className="rounded-md border border-dashed border-module-border px-3 py-2 system-xs-regular text-text-tertiary">
              {t('requestLogs.contents.clientResponseNotDelivered')}
            </div>
          )}
        </div>
      </div>
    )
  } else if (props.selectedAttemptId) {
    state = <div className="py-8 text-center system-xs-regular text-text-tertiary">{t('requestLogs.contents.noRecord')}</div>
  } else {
    state = null
  }

  return (
    <Sheet open={Boolean(props.selectedAttemptId)} onOpenChange={open => !open && props.onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-3xl! flex-col gap-0 border-0 bg-card p-0 shadow-none" onOpenAutoFocus={event => event.preventDefault()}>
        <SheetHeader className="shrink-0 border-b border-border/50 px-4 py-3.5 pr-12">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span>{selectedAttempt ? t('requestLogs.contents.title', { index: selectedAttempt.attemptIndex + 1, total: props.attempts.length }) : t('requestLogs.contents.titleFallback')}</span>
            {/* 结果就是 HTTP 状态，与列表行用同一套徽标，Sheet 里不再另说一遍。 */}
            {selectedAttempt && (
              <span className={cn(
                'rounded-sm px-1.5 py-0.5 font-mono system-2xs-medium',
                selectedAttempt.status === 'success'
                  ? 'bg-success/10 text-text-success'
                  : 'bg-destructive/10 text-text-destructive',
              )}>
                {formatAttemptOutcome(t, selectedAttempt)}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {selectedAttempt
              ? `${selectedAttempt.providerName} / ${selectedAttempt.providerModelName}`
              : t('requestLogs.contents.description')}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">{state}</div>
      </SheetContent>
    </Sheet>
  )
}
