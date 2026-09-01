import * as React from 'react'
import { AlertCircle, ChevronDown, LoaderCircle, Search } from 'lucide-react'
import type { AppliedRequestRewriteRule, RequestContent, RequestConversion, RequestLogEntryAttempt } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { formatContent } from '../lib/format-content'
import { PROTOCOL_LABEL } from '../lib/format'

interface ContentSectionProps {
  id: string
  label: string
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface RequestStageSection {
  id: string
  label: string
  value: string | null
}

interface RequestStageProps {
  title: string
  protocol: string
  sections: RequestStageSection[]
  sectionStates: Record<string, boolean>
  onSectionOpenChange: (id: string, open: boolean) => void
}

interface AppliedRulesProps {
  ruleIds: string[]
  rules: AppliedRequestRewriteRule[] | null
}

interface AttemptErrorProps {
  attempt: RequestLogEntryAttempt
}

interface RequestContentsSheetProps {
  contents: RequestContent[] | null
  conversions: RequestConversion[] | null
  attempts: RequestLogEntryAttempt[]
  requestRewriteRules: AppliedRequestRewriteRule[] | null
  clientProtocol: string
  upstreamProtocol?: string | null
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  onClose: () => void
}

function sectionKey(title: string, label: string) {
  return `${title}::${label}`
}

function ContentSection(props: ContentSectionProps) {
  const content = formatContent(props.value)

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange} className="overflow-hidden rounded-md bg-inset">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 bg-muted/30 px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/50">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{props.label}</span>
          {content.isJson && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">JSON</span>}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-muted-foreground transition-transform', !props.open && '-rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="whitespace-pre-wrap break-all bg-inset p-3 font-mono text-xs leading-5 text-foreground/90">{content.value}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AppliedRules(props: AppliedRulesProps) {
  if (props.ruleIds.length === 0) return null
  const ruleNames = new Map(props.rules?.map(rule => [rule.id, rule.name]) ?? [])

  return (
    <section className="rounded-lg bg-info/8 px-3 py-2.5">
      <div className="text-xs font-medium">已应用修改器</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {props.ruleIds.map(id => <span key={id} className="rounded bg-info/15 px-1.5 py-0.5 text-[10px] text-info">{ruleNames.get(id) ?? id}</span>)}
      </div>
    </section>
  )
}

function RequestStage(props: RequestStageProps) {
  const sections = props.sections.filter(section => section.value)
  if (sections.length === 0) return null

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 text-sm font-medium">
        <span>{props.title}</span>
        <span className="font-mono text-xs text-muted-foreground">· {PROTOCOL_LABEL[props.protocol] ?? props.protocol}</span>
      </div>
      <div className="space-y-2 px-2 pb-2 pt-2">
        {sections.map(section => (
          <ContentSection
            key={section.id}
            id={section.id}
            label={section.label}
            value={section.value!}
            open={props.sectionStates[section.id] ?? true}
            onOpenChange={open => props.onSectionOpenChange(section.id, open)}
          />
        ))}
      </div>
    </section>
  )
}

function AttemptError(props: AttemptErrorProps) {
  const { attempt } = props
  if (!attempt.errorCode && !attempt.errorMessage && !attempt.details) return null

  return (
    <section className="rounded-lg bg-red-500/8 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2 font-medium text-red-700 dark:text-red-300">
        <AlertCircle size={14} />
        <span>{attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '上游请求失败'}</span>
        {attempt.errorCode && <span className="font-mono text-[10px] font-normal">{attempt.errorCode}</span>}
      </div>
      {attempt.errorMessage && <div className="mt-1 wrap-break-word text-red-700/90 dark:text-red-300/90">{attempt.errorMessage}</div>}
      {attempt.details && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-red-500/8 p-2 font-mono text-[11px] leading-5 text-foreground/90">{formatContent(attempt.details).value}</pre>}
    </section>
  )
}

type RequestStageData = Omit<RequestStageProps, 'sectionStates' | 'onSectionOpenChange'>

type RequestStageBuilderInput = {
  clientContent: RequestContent | null
  selectedContent: RequestContent | null
  conversion: RequestConversion | null
  clientProtocol: string
  upstreamProtocol: string
}

function buildRequestStages(input: RequestStageBuilderInput): RequestStageData[] {
  const { clientContent, selectedContent, conversion, clientProtocol, upstreamProtocol } = input
  const clientLabel = PROTOCOL_LABEL[clientProtocol] ?? clientProtocol
  const upstreamLabel = PROTOCOL_LABEL[upstreamProtocol] ?? upstreamProtocol
  const converted = Boolean(conversion && conversion.clientProtocol !== conversion.upstreamProtocol)
  const upstreamRequestTitle = converted ? '协议转换后的上游请求' : '发送到真实供应商的请求'
  const clientResponseTitle = converted ? '协议转换后的客户端响应' : '返回客户端的响应'

  return [
    {
      title: '客户端原始请求',
      protocol: clientProtocol,
      sections: [
        { id: sectionKey('客户端原始请求', `请求头 · ${clientLabel}`), label: `请求头 · ${clientLabel}`, value: conversion?.clientRequestHeaders ?? clientContent?.requestHeaders ?? null },
        { id: sectionKey('客户端原始请求', `请求 Body · ${clientLabel}`), label: `请求 Body · ${clientLabel}`, value: clientContent?.requestBody ?? null },
      ],
    },
    {
      title: upstreamRequestTitle,
      protocol: upstreamProtocol,
      sections: [
        { id: sectionKey(upstreamRequestTitle, `请求头 · ${upstreamLabel}`), label: `请求头 · ${upstreamLabel}`, value: conversion?.upstreamRequestHeaders ?? selectedContent?.requestHeaders ?? null },
        { id: sectionKey(upstreamRequestTitle, `请求 Body · ${upstreamLabel}`), label: `请求 Body · ${upstreamLabel}`, value: conversion?.requestBody ?? selectedContent?.requestBody ?? null },
      ],
    },
    {
      title: '真实供应商响应',
      protocol: upstreamProtocol,
      sections: [
        { id: sectionKey('真实供应商响应', `响应头 · ${upstreamLabel}`), label: `响应头 · ${upstreamLabel}`, value: conversion?.upstreamResponseHeaders ?? selectedContent?.upstreamResponseHeaders ?? selectedContent?.responseHeaders ?? null },
        { id: sectionKey('真实供应商响应', `响应 Body · ${upstreamLabel}`), label: `响应 Body · ${upstreamLabel}`, value: selectedContent?.responseBody ?? null },
      ],
    },
    {
      title: clientResponseTitle,
      protocol: clientProtocol,
      sections: [
        { id: sectionKey(clientResponseTitle, `响应头 · ${clientLabel}`), label: `响应头 · ${clientLabel}`, value: conversion?.clientResponseHeaders ?? selectedContent?.clientResponseHeaders ?? selectedContent?.responseHeaders ?? null },
        { id: sectionKey(clientResponseTitle, `响应 Body · ${clientLabel}`), label: `响应 Body · ${clientLabel}`, value: conversion?.responseBody ?? selectedContent?.responseBody ?? null },
      ],
    },
  ]
}

export function RequestContentsSheet(props: RequestContentsSheetProps) {
  const selectedAttempt = props.attempts.find(attempt => attempt.id === props.selectedAttemptId) ?? null
  const selectedContent = props.contents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  const clientContent = props.contents?.find(content => content.attemptId === null) ?? null
  const conversion = props.conversions?.find(item => item.attemptId === props.selectedAttemptId) ?? null
  const [search, setSearch] = React.useState('')
  const [sectionStates, setSectionStates] = React.useState<Record<string, boolean>>({})

  const clientProtocol = conversion?.clientProtocol ?? props.clientProtocol
  const upstreamProtocol = conversion?.upstreamProtocol ?? props.upstreamProtocol ?? clientProtocol

  React.useEffect(() => {
    setSearch('')
    setSectionStates({})
  }, [props.selectedAttemptId])

  const stages: RequestStageProps[] = buildRequestStages({
    clientContent,
    selectedContent,
    conversion,
    clientProtocol,
    upstreamProtocol,
  }).map(stage => ({
    ...stage,
    sectionStates,
    onSectionOpenChange: (id, open) => setSectionStates(current => ({ ...current, [id]: open })),
  }))

  const normalizedSearch = search.trim().toLowerCase()
  const filteredStages = normalizedSearch
    ? stages
        .map(stage => ({
          ...stage,
          sections: stage.sections.filter(section => `${section.label} ${section.value ?? ''}`.toLowerCase().includes(normalizedSearch)),
        }))
        .filter(stage => stage.sections.length > 0)
    : stages
  const visibleSectionIds = filteredStages.flatMap(stage => stage.sections.map(section => section.id))

  let state: React.ReactNode
  if (props.loading) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <LoaderCircle size={15} className="animate-spin" />
        正在加载正文
      </div>
    )
  } else if (props.error) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-red-600 dark:text-red-400">
        <AlertCircle size={15} />
        {props.error}
      </div>
    )
  } else if (selectedAttempt || clientContent) {
    state = (
      <div className="flex h-full min-h-0 flex-col">
        <div className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索请求详情内容"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="搜索内容"
                className="h-8 pl-8 text-xs"
              />
            </div>
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
              全展开
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
              全折叠
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-3">
          {selectedAttempt && <AttemptError attempt={selectedAttempt} />}
          <AppliedRules ruleIds={selectedContent?.requestRewriteRuleIds ?? []} rules={props.requestRewriteRules} />
          {filteredStages.length > 0 ? (
            filteredStages.map(stage => <RequestStage key={stage.title} {...stage} />)
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到匹配内容</div>
          )}
        </div>
      </div>
    )
  } else if (props.selectedAttemptId) {
    state = <div className="py-8 text-center text-sm text-muted-foreground">该尝试没有可查看的记录</div>
  } else {
    state = null
  }

  return (
    <Sheet open={Boolean(props.selectedAttemptId)} onOpenChange={open => !open && props.onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-3xl! flex-col gap-0 border-0 bg-card p-0 shadow-none" onOpenAutoFocus={event => event.preventDefault()}>
        <SheetHeader className="shrink-0 px-4 py-3.5 pr-12">
          <SheetTitle className="text-sm">请求详情</SheetTitle>
          <SheetDescription className="text-xs">按请求链路和采集时的原始字符串展示</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">{state}</div>
      </SheetContent>
    </Sheet>
  )
}
