import * as React from 'react'
import { AlertCircle, ChevronDown, LoaderCircle, X } from 'lucide-react'
import type { RequestContent } from '@common/schemas'
import { cn } from '@/lib/utils'
import { PROTOCOL_LABEL } from '../lib/format'

interface ContentSectionProps {
  label: string
  value: string
}
interface RequestContentsDrawerProps {
  contents: RequestContent[] | null
  clientProtocol: string
  providerProtocol?: string | null
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  onClose: () => void
}
interface ConversionRecord { fromProtocol?: string | null; toProtocol?: string | null; convertedRequestBody?: string | null; convertedResponseBody?: string | null }

function formatContent(value: string) { try { const parsed = JSON.parse(value) as unknown; return { value: JSON.stringify(parsed, null, 2), isJson: true } } catch { return { value, isJson: false } } }
function ContentSection(props: ContentSectionProps) {
  const [open, setOpen] = React.useState(true)
  const content = formatContent(props.value)
  return <div className="overflow-hidden rounded-md border border-border"><button type="button" className="flex w-full items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-left text-[11px] font-medium hover:bg-muted/50" aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="flex min-w-0 items-center gap-2"><span className="truncate">{props.label}</span>{content.isJson && <span className="shrink-0 rounded border border-border px-1 font-mono text-[9px] font-normal text-muted-foreground">JSON</span>}</span><ChevronDown size={14} className={cn('shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} /></button>{open && <pre className="whitespace-pre-wrap break-all border-t border-border bg-inset p-3 font-mono text-[11px] leading-5 text-foreground/90">{content.value}</pre>}</div>
}

export function RequestContentsDrawer(props: RequestContentsDrawerProps) {
  const selectedContent = props.contents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  const conversion = selectedContent?.conversions ? JSON.parse(selectedContent.conversions) as ConversionRecord : null
  const clientProtocol = conversion?.fromProtocol ?? props.clientProtocol
  const providerProtocol = conversion?.toProtocol ?? props.providerProtocol ?? props.clientProtocol
  const clientLabel = PROTOCOL_LABEL[clientProtocol] ?? clientProtocol
  const providerLabel = PROTOCOL_LABEL[providerProtocol] ?? providerProtocol
  const sections: Array<[string, string | null]> = selectedContent ? [
    [`请求头 · 发往供应商 · ${providerLabel}`, selectedContent.requestHeaders], [`请求正文 · 发往供应商 · ${providerLabel}`, selectedContent.requestBody],
    ...(conversion?.convertedRequestBody ? [[`转换后请求 · ${clientLabel} → ${providerLabel}`, conversion.convertedRequestBody] as [string, string]] : []),
    ...(conversion?.convertedResponseBody ? [[`转换后响应 · ${providerLabel} → ${clientLabel}`, conversion.convertedResponseBody] as [string, string]] : []),
    [`响应头 · 返回客户端 · ${clientLabel}`, selectedContent.responseHeaders], [`响应正文 · 返回客户端 · ${clientLabel}`, selectedContent.responseBody],
  ] : []
  let state
  if (props.loading) state = <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />正在加载正文</div>
  else if (props.error) state = <div className="flex items-center justify-center gap-2 py-8 text-xs text-red-600 dark:text-red-400"><AlertCircle size={14} />{props.error}</div>
  else if (selectedContent) state = sections.map(([label, value]) => value && <ContentSection key={label} label={label} value={value} />)
  else if (props.selectedAttemptId) state = <div className="py-8 text-center text-xs text-muted-foreground">该尝试没有正文记录</div>
  else state = null
  return <><div className={cn('fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l bg-card shadow-2xl transition-transform duration-200', props.selectedAttemptId ? 'translate-x-0' : 'translate-x-full')}><div className="flex h-full flex-col"><div className="flex items-start justify-between border-b px-4 py-3"><div><h2 className="text-xs font-medium">请求详情</h2><p className="mt-0.5 text-[10px] text-muted-foreground">按采集时的原始字符串展示</p></div><button type="button" aria-label="关闭正文" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={props.onClose}><X size={14} /></button></div><div className="flex-1 space-y-3 overflow-auto p-4">{state}</div></div></div>{props.selectedAttemptId && <button type="button" aria-label="关闭正文" className="fixed inset-0 z-40 bg-black/30" onClick={props.onClose} />}</>
}
