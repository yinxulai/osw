import * as React from 'react'
import { AlertCircle, ChevronDown, LoaderCircle, X } from 'lucide-react'
import type { RequestContent, RequestConversion } from '@common/schemas'
import { cn } from '@/lib/utils'
import { PROTOCOL_LABEL } from '../lib/format'

interface ContentSectionProps {
  label: string
  value: string
}
interface RequestStageProps {
  title: string
  protocol: string
  sections: Array<[string, string | null]>
}
interface RequestContentsDrawerProps {
  contents: RequestContent[] | null
  conversions: RequestConversion[] | null
  clientProtocol: string
  upstreamProtocol?: string | null
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  onClose: () => void
}
function formatContent(value: string) { try { const parsed = JSON.parse(value) as unknown; return { value: JSON.stringify(parsed, null, 2), isJson: true } } catch { return { value, isJson: false } } }
function ContentSection(props: ContentSectionProps) {
  const [open, setOpen] = React.useState(true)
  const content = formatContent(props.value)
  return <div className="overflow-hidden rounded-md bg-inset"><button type="button" className="flex w-full items-center justify-between gap-3 bg-muted/30 px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/50" aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="flex min-w-0 items-center gap-2"><span className="truncate">{props.label}</span>{content.isJson && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">JSON</span>}</span><ChevronDown size={15} className={cn('shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} /></button>{open && <pre className="whitespace-pre-wrap break-all bg-inset p-3 font-mono text-xs leading-5 text-foreground/90">{content.value}</pre>}</div>
}
function RequestStage(props: RequestStageProps) {
  const sections = props.sections.filter(([, value]) => value)
  if (sections.length === 0) return null
  return <section className="overflow-hidden rounded-lg bg-muted/20"><div className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium"><span>{props.title}</span><span className="font-mono text-xs text-muted-foreground">· {PROTOCOL_LABEL[props.protocol] ?? props.protocol}</span></div><div className="space-y-2 px-2 pb-2">{sections.map(([label, value]) => <ContentSection key={label} label={label} value={value!} />)}</div></section>
}

export function RequestContentsDrawer(props: RequestContentsDrawerProps) {
  const selectedContent = props.contents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  const clientContent = props.contents?.find(content => content.attemptId === null) ?? null
  const conversion = props.conversions?.find(item => item.attemptId === props.selectedAttemptId) ?? null
  const clientProtocol = conversion?.clientProtocol ?? props.clientProtocol
  const upstreamProtocol = conversion?.upstreamProtocol ?? props.upstreamProtocol ?? clientProtocol
  const clientLabel = PROTOCOL_LABEL[clientProtocol] ?? clientProtocol
  const upstreamLabel = PROTOCOL_LABEL[upstreamProtocol] ?? upstreamProtocol
  const converted = Boolean(conversion && conversion.clientProtocol !== conversion.upstreamProtocol)
  const stages: RequestStageProps[] = [
    {
      title: '客户端原始请求',
      protocol: clientProtocol,
      sections: [[`请求头 · ${clientLabel}`, conversion?.clientRequestHeaders ?? clientContent?.requestHeaders ?? null], [`请求 Body · ${clientLabel}`, clientContent?.requestBody ?? null]],
    },
    {
      title: converted ? '协议转换后的上游请求' : '发送到真实供应商的请求',
      protocol: upstreamProtocol,
      sections: [[`请求头 · ${upstreamLabel}`, conversion?.upstreamRequestHeaders ?? selectedContent?.requestHeaders ?? null], [`请求 Body · ${upstreamLabel}`, conversion?.requestBody ?? selectedContent?.requestBody ?? null]],
    },
    {
      title: '真实供应商响应',
      protocol: upstreamProtocol,
      sections: [[`响应头 · ${upstreamLabel}`, conversion?.upstreamResponseHeaders ?? selectedContent?.responseHeaders ?? null], [`响应 Body · ${upstreamLabel}`, selectedContent?.responseBody ?? null]],
    },
    {
      title: converted ? '协议转换后的客户端响应' : '返回客户端的响应',
      protocol: clientProtocol,
      sections: [[`响应头 · ${clientLabel}`, conversion?.clientResponseHeaders ?? selectedContent?.responseHeaders ?? null], [`响应 Body · ${clientLabel}`, conversion?.responseBody ?? selectedContent?.responseBody ?? null]],
    },
  ]
  let state
  if (props.loading) state = <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />正在加载正文</div>
  else if (props.error) state = <div className="flex items-center justify-center gap-2 py-8 text-sm text-red-600 dark:text-red-400"><AlertCircle size={15} />{props.error}</div>
  else if (selectedContent || clientContent) state = stages.map(stage => <RequestStage key={stage.title} {...stage} />)
  else if (props.selectedAttemptId) state = <div className="py-8 text-center text-sm text-muted-foreground">该尝试没有正文记录</div>
  else state = null
  return <><div className={cn('fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-card transition-transform duration-200', props.selectedAttemptId ? 'translate-x-0' : 'translate-x-full')}><div className="flex h-full flex-col"><div className="flex items-start justify-between px-4 py-3.5"><div><h2 className="text-sm font-medium">请求详情</h2><p className="mt-0.5 text-xs text-muted-foreground">按请求链路和采集时的原始字符串展示</p></div><button type="button" aria-label="关闭正文" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={props.onClose}><X size={15} /></button></div><div className="flex-1 space-y-3 overflow-auto px-4 pb-4">{state}</div></div></div>{props.selectedAttemptId && <button type="button" aria-label="关闭正文" className="fixed inset-0 z-40 bg-black/30" onClick={props.onClose} />}</>
}
