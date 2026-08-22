import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { EmptyState } from '@/components/ui/empty-state'
import { RequestLogsFilters, type RequestLogsFilter, type StatusFilter } from './components/request-logs-filters'
import { RequestLogsTable } from './components/request-logs-table'
import { PAGE_SIZE } from './hooks/use-request-log-list'
import { useRequestLogsService } from './service'

export function RequestLogsPage() {
  const { logs, total, providers, logicalModels, loading, refreshing, details, detailLoadingIds, detailErrors, getModelName, loadDetail, refresh, setFilter } = useRequestLogsService()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [logicalModelFilter, setLogicalModelFilter] = useState<string>('all')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)

  const applyFilter = (next: Partial<RequestLogsFilter>) => {
    if (next.providerId !== undefined) setProviderFilter(next.providerId)
    if (next.logicalModelId !== undefined) setLogicalModelFilter(next.logicalModelId)
    if (next.protocol !== undefined) setProtocolFilter(next.protocol)
    if (next.status !== undefined) setStatusFilter(next.status as StatusFilter)
    if (next.createdTimeFrom !== undefined) setFromDate(next.createdTimeFrom === null ? '' : new Date(next.createdTimeFrom).toISOString().slice(0, 10))
    if (next.createdTimeTo !== undefined) setToDate(next.createdTimeTo === null ? '' : new Date(next.createdTimeTo - 1).toISOString().slice(0, 10))
    setPage(1)
    void setFilter(next)
  }

  const providerOptions = useMemo(() => {
    return providers
      .map(p => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providers])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    setPage(clamped)
    void refresh(clamped)
  }

  const toggleExpand = (id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id
      if (next) void loadDetail(next)
      return next
    })
  }

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的代理请求，以及每次请求实际使用的供应商模型与失败切换情况"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
            刷新
          </Button>
        }
      />
      <PageContent>
        <RequestLogsFilters
          providerFilter={providerFilter}
          logicalModelFilter={logicalModelFilter}
          protocolFilter={protocolFilter}
          statusFilter={statusFilter}
          fromDate={fromDate}
          toDate={toDate}
          providerOptions={providerOptions}
          logicalModels={logicalModels}
          total={total}
          applyFilter={applyFilter}
          setFromDate={setFromDate}
          setToDate={setToDate}
        />
        {!loading && logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="暂无请求记录"
            description="通过本地代理发起请求后，这里会记录实际使用的模型、耗时、缓存与故障切换详情。"
            className="min-h-64"
          />
        ) : <RequestLogsTable
          logs={logs}
          loading={loading}
          expandedId={expandedId}
          details={details}
          detailLoadingIds={detailLoadingIds}
          detailErrors={detailErrors}
          getModelName={getModelName}
          toggleExpand={toggleExpand}
        />}
        {!loading && total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-foreground/75">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
