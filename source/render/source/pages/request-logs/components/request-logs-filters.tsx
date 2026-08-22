import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RequestLogFilter } from '../service'

export type StatusFilter = 'all' | 'pending' | 'success' | 'failed' | 'cancelled'
export type RequestLogsFilter = RequestLogFilter

interface RequestLogsFiltersProps {
  providerFilter: string
  logicalModelFilter: string
  protocolFilter: string
  statusFilter: StatusFilter
  fromDate: string
  toDate: string
  providerOptions: Array<{ id: string; name: string }>
  logicalModels: Array<{ id: string; name: string }>
  total: number
  applyFilter: (next: Partial<RequestLogsFilter>) => void
  setFromDate: (value: string) => void
  setToDate: (value: string) => void
}

const protocolOptions = ['openai-responses', 'openai-completions', 'anthropic-messages']

export function RequestLogsFilters(props: RequestLogsFiltersProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select value={props.providerFilter} onValueChange={value => props.applyFilter({ providerId: value })}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="全部渠道" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部渠道</SelectItem>
          {props.providerOptions.map(provider => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.logicalModelFilter} onValueChange={value => props.applyFilter({ logicalModelId: value })}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="全部模型" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部模型</SelectItem>
          {props.logicalModels.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.protocolFilter} onValueChange={value => props.applyFilter({ clientProtocol: value })}>
        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="全部协议" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部协议</SelectItem>
          {protocolOptions.map(protocol => <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.statusFilter} onValueChange={value => props.applyFilter({ status: value as StatusFilter })}>
        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="全部状态" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="pending">进行中</SelectItem>
          <SelectItem value="success">成功</SelectItem>
          <SelectItem value="failed">失败</SelectItem>
          <SelectItem value="cancelled">已取消</SelectItem>
        </SelectContent>
      </Select>
      <input aria-label="开始日期" type="date" value={props.fromDate} onChange={event => {
        const value = event.target.value
        props.setFromDate(value)
        props.applyFilter({ createdTimeFrom: value ? new Date(`${value}T00:00:00`).getTime() : null })
      }} className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
      <input aria-label="结束日期" type="date" value={props.toDate} onChange={event => {
        const value = event.target.value
        props.setToDate(value)
        props.applyFilter({ createdTimeTo: value ? new Date(`${value}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : null })
      }} className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
      <span className="text-xs text-foreground/75">共 {props.total} 条</span>
    </div>
  )
}
