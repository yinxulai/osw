import { DateRangePicker } from '@/components/date-range-picker'
import { FilterBar } from '@/components/filter-bar'
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

/** 结束日按「含当天」折算成时间戳：选到 2026-01-15 就要包含这一整天，取次日零点。 */
const DAY_MS = 24 * 60 * 60 * 1000

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
      <DateRangePicker
        label={t('requestLogs.filters.dateRange')}
        className="w-64"
        value={{ from: props.filter.createdTimeFrom, to: props.filter.createdTimeTo === null ? null : props.filter.createdTimeTo - DAY_MS }}
        onChange={value => props.applyFilter({
          createdTimeFrom: value.from,
          createdTimeTo: value.to === null ? null : value.to + DAY_MS,
        })}
      />
      <span className="system-xs-regular text-text-tertiary">{t('requestLogs.filters.totalCount', { count: props.total })}</span>
    </FilterBar>
  )
}
