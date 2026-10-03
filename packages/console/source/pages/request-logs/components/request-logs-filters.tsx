import { CalendarRange } from 'lucide-react'
import { FilterBar } from '@/components/filter-bar'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslation } from '@/i18n/provider'
import type { RequestLogFilter } from '../service'

export type StatusFilter = 'all' | 'pending' | 'success' | 'failed' | 'cancelled'
export type RequestLogsFilter = RequestLogFilter

interface RequestLogsFiltersProps {
  filter: RequestLogsFilter
  providerOptions: Array<{ id: string; name: string }>
  providerModelOptions: Array<{ id: string; name: string }>
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
  const t = useTranslation()
  return (
    <FilterBar dataScreenshot="request-logs-filters">
      <Select value={props.filter.providerId} onValueChange={value => props.applyFilter({ providerId: value })}>
        <SelectTrigger aria-label={t('requestLogs.filters.channel')} className="w-40"><SelectValue placeholder={t('requestLogs.filters.allChannels')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('requestLogs.filters.allChannels')}</SelectItem>
          {props.providerOptions.map(provider => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.filter.providerModelId} onValueChange={value => props.applyFilter({ providerModelId: value })}>
        <SelectTrigger aria-label={t('requestLogs.filters.providerModel')} className="w-48"><SelectValue placeholder={t('requestLogs.filters.allProviderModels')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('requestLogs.filters.allProviderModels')}</SelectItem>
          {props.providerModelOptions.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.filter.clientProtocol} onValueChange={value => props.applyFilter({ clientProtocol: value })}>
        <SelectTrigger aria-label={t('requestLogs.filters.protocol')} className="w-36"><SelectValue placeholder={t('requestLogs.filters.allProtocols')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('requestLogs.filters.allProtocols')}</SelectItem>
          {protocolOptions.map(protocol => <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={props.filter.status} onValueChange={value => props.applyFilter({ status: value as StatusFilter })}>
        <SelectTrigger aria-label={t('requestLogs.filters.status')} className="w-32"><SelectValue placeholder={t('requestLogs.filters.allStatuses')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('requestLogs.filters.allStatuses')}</SelectItem>
          <SelectItem value="pending">{t('requestLogs.status.pending')}</SelectItem>
          <SelectItem value="success">{t('requestLogs.status.success')}</SelectItem>
          <SelectItem value="failed">{t('requestLogs.status.failed')}</SelectItem>
          <SelectItem value="cancelled">{t('requestLogs.status.cancelled')}</SelectItem>
        </SelectContent>
      </Select>
      <label className="relative flex items-center" title={t('requestLogs.filters.startDate')}>
        <CalendarRange className="pointer-events-none absolute left-3 size-3.5 text-text-tertiary" aria-hidden />
        <Input aria-label={t('requestLogs.filters.startDate')} type="date" value={toDateInput(props.filter.createdTimeFrom)} onChange={event => {
          const value = event.target.value
          props.applyFilter({ createdTimeFrom: value ? new Date(`${value}T00:00:00`).getTime() : null })
        }} className="w-40 pl-9" />
      </label>
      <label className="relative flex items-center" title={t('requestLogs.filters.endDate')}>
        <CalendarRange className="pointer-events-none absolute left-3 size-3.5 text-text-tertiary" aria-hidden />
        <Input aria-label={t('requestLogs.filters.endDate')} type="date" value={toDateInput(props.filter.createdTimeTo, true)} onChange={event => {
          const value = event.target.value
          props.applyFilter({ createdTimeTo: value ? new Date(`${value}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : null })
        }} className="w-40 pl-9" />
      </label>
      <span className="system-xs-regular text-text-tertiary">{t('requestLogs.filters.totalCount', { count: props.total })}</span>
    </FilterBar>
  )
}
