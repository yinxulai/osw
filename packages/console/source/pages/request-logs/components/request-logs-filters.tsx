import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import type { ApiKey, Protocol } from '@common/schemas'
import { DateRangePicker } from '@/components/date-range-picker'
import { FilterBar } from '@/components/filter-bar'
import { SearchableSelect } from '@/components/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslation } from '@/i18n/provider'
import { shiftLocalCalendarDays } from '@/lib/calendar-day'
import { ANONYMOUS_API_KEY } from '../lib/api-key-filter'
import type { RequestLogFilter } from '../service'

export type StatusFilter = 'all' | 'pending' | 'success' | 'failed' | 'cancelled'
export type RequestLogsFilter = RequestLogFilter

interface RequestLogsFiltersProps {
  filter: RequestLogsFilter
  /** 只保留「供应商模型」这一维筛选：供应商自身那一维与它是父子关系，一起给用户只是重复。 */
  providerModelOptions: Array<{ id: string; name: string }>
  /** 当前已知的 API Key：用来选「只看某一把」，以及把记录里的 id 映回名字。 */
  apiKeys: ApiKey[]
  total: number
  applyFilter: (next: Partial<RequestLogsFilter>) => void
}

const protocolOptions: readonly Protocol[] = ['openai-responses', 'openai-completions', 'anthropic-messages']

export function RequestLogsFilters(props: RequestLogsFiltersProps) {
  const t = useTranslation()
  // 选择器的结束日是当天零点（含当天）。查询是 `createdTime < createdTimeTo`，上界取次日零点。
  const inclusiveTo = props.filter.createdTimeTo === null ? null : shiftLocalCalendarDays(props.filter.createdTimeTo, -1)
  return (
    <FilterBar dataScreenshot="request-logs-filters">
      <SearchableSelect
        value={props.filter.providerModelId}
        onValueChange={value => props.applyFilter({ providerModelId: value })}
        options={props.providerModelOptions.map(model => ({ value: model.id, label: model.name }))}
        allOption={{ value: 'all', label: t('requestLogs.filters.allProviderModels') }}
        label={t('requestLogs.filters.providerModel')}
        searchPlaceholder={t('requestLogs.filters.providerModelSearch')}
        emptyLabel={t('requestLogs.filters.providerModelEmpty')}
        className="w-56"
      />
      {/*
       * 「未署名」是一个真实选项而不是「全部」的同义词：没开校验时全部请求都在那一组，
       * 排查「到底是谁在花额度」时它和「全部」是两种问法。
       */}
      <SearchableSelect
        value={props.filter.apiKeyId}
        onValueChange={value => props.applyFilter({ apiKeyId: value })}
        options={[
          ...props.apiKeys.map(key => ({ value: key.id, label: key.name })),
          { value: ANONYMOUS_API_KEY, label: t('apiKeys.usage.anonymous') },
        ]}
        allOption={{ value: 'all', label: t('requestLogs.filters.allApiKeys') }}
        label={t('requestLogs.filters.apiKey')}
        searchPlaceholder={t('requestLogs.filters.apiKeySearch')}
        emptyLabel={t('requestLogs.filters.apiKeyEmpty')}
        className="w-44"
      />
      <Select value={props.filter.clientProtocol} onValueChange={value => props.applyFilter({ clientProtocol: value })}>
        <SelectTrigger aria-label={t('requestLogs.filters.protocol')} className="w-36"><SelectValue placeholder={t('requestLogs.filters.allProtocols')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('requestLogs.filters.allProtocols')}</SelectItem>
          {protocolOptions.map(protocol => <SelectItem key={protocol} value={protocol}>{PROTOCOL_DISPLAY_NAMES[protocol]}</SelectItem>)}
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
        value={{ from: props.filter.createdTimeFrom, to: inclusiveTo }}
        onChange={value => props.applyFilter({
          createdTimeFrom: value.from,
          createdTimeTo: value.to === null ? null : shiftLocalCalendarDays(value.to, 1),
        })}
      />
      <span className="system-xs-regular text-text-tertiary">{t('requestLogs.filters.totalCount', { count: props.total })}</span>
    </FilterBar>
  )
}
