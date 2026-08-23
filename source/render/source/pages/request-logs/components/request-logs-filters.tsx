import { FilterBar } from '@/components/filter-bar'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RequestLogFilter } from '../service'

export type StatusFilter = 'all' | 'pending' | 'success' | 'failed' | 'cancelled'
export type RequestLogsFilter = RequestLogFilter

interface RequestLogsFiltersProps {
  filter: RequestLogsFilter
  providerOptions: Array<{ id: string; name: string }>
  logicalModels: Array<{ id: string; name: string }>
  total: number
  applyFilter: (next: Partial<RequestLogsFilter>) => void
}

const protocolOptions = ['openai-responses', 'openai-completions', 'anthropic-messages']

function toDateInput(timestamp: number | null, endDate = false) {
  if (timestamp === null) return ''
  const date = new Date(endDate ? timestamp - 1 : timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function RequestLogsFilters(props: RequestLogsFiltersProps) {
  return (
    <FilterBar className="mb-3">
      <Select value={props.filter.providerId} onValueChange={value => props.applyFilter({ providerId: value })}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="全部渠道" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部渠道</SelectItem>
          {props.providerOptions.map(provider => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.filter.logicalModelId} onValueChange={value => props.applyFilter({ logicalModelId: value })}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="全部模型" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部模型</SelectItem>
          {props.logicalModels.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.filter.clientProtocol} onValueChange={value => props.applyFilter({ clientProtocol: value })}>
        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="全部协议" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部协议</SelectItem>
          {protocolOptions.map(protocol => <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.filter.status} onValueChange={value => props.applyFilter({ status: value as StatusFilter })}>
        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="全部状态" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="pending">进行中</SelectItem>
          <SelectItem value="success">成功</SelectItem>
          <SelectItem value="failed">失败</SelectItem>
          <SelectItem value="cancelled">已取消</SelectItem>
        </SelectContent>
      </Select>
      <Input aria-label="开始日期" type="date" value={toDateInput(props.filter.createdTimeFrom)} onChange={event => {
        const value = event.target.value
        props.applyFilter({ createdTimeFrom: value ? new Date(`${value}T00:00:00`).getTime() : null })
      }} className="h-8 w-36 text-xs" />
      <Input aria-label="结束日期" type="date" value={toDateInput(props.filter.createdTimeTo, true)} onChange={event => {
        const value = event.target.value
        props.applyFilter({ createdTimeTo: value ? new Date(`${value}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : null })
      }} className="h-8 w-36 text-xs" />
      <span className="text-xs text-muted-foreground">共 {props.total} 条</span>
    </FilterBar>
  )
}
