import { Activity, FlaskConical, Loader2 } from 'lucide-react'
import type { Protocol } from '@common/schemas'
import type { ModelTestResult } from '@/api'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface ProtocolTestResult extends ModelTestResult {
  protocol: Protocol
}

interface QueueTestControlsProps {
  protocols: Protocol[]
  selectedProtocol: Protocol | 'all'
  running: boolean
  disabled: boolean
  onProtocolChange: (protocol: Protocol | 'all') => void
  onRun: () => void
}

interface QueueTestSummaryProps {
  protocolCount: number
  results: ProtocolTestResult[]
  onClose: () => void
}

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic',
}

export function QueueTestControls(props: QueueTestControlsProps) {
  if (props.protocols.length === 0) return null

  return (
    <div className="flex items-center overflow-hidden rounded-md border bg-background shadow-sm">
      <Select value={props.selectedProtocol} onValueChange={value => props.onProtocolChange(value as Protocol | 'all')}>
        <SelectTrigger className="h-8 w-36 rounded-none border-0 border-r bg-muted/20 text-[11px] shadow-none focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部协议</SelectItem>
          {props.protocols.map(protocol => (
            <SelectItem key={protocol} value={protocol}>{PROTOCOL_LABELS[protocol]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 rounded-none px-3 text-[11px]"
        onClick={props.onRun}
        disabled={props.running || props.disabled}
      >
        {props.running ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
        {props.running ? '探测中' : '运行探测'}
      </Button>
    </div>
  )
}

export function QueueTestSummary(props: QueueTestSummaryProps) {
  const successCount = props.results.filter(result => result.success).length
  const failureCount = props.results.length - successCount

  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 rounded-lg border bg-muted/20 px-3 py-2.5 text-[11px]">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium">
          <Activity size={12} className="text-primary" />
          队列连通性报告
        </div>
        <div className="mt-0.5 truncate text-muted-foreground">
          已探测 {props.protocolCount} 个协议、{props.results.length} 个可用绑定
        </div>
      </div>
      <div className="text-center">
        <div className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">{successCount}</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">成功</div>
      </div>
      <div className="text-center">
        <div className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">{failureCount}</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">失败</div>
      </div>
      <button className="text-muted-foreground hover:text-foreground" onClick={props.onClose}>关闭</button>
    </div>
  )
}
