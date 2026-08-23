import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { EmptyState } from '@/components/ui/empty-state'
import { RequestLogsFilters } from './components/request-logs-filters'
import { RequestLogsTable } from './components/request-logs-table'
import { PAGE_SIZE } from './queries'
import { useRequestLogsService } from './service'

export function RequestLogsPage() {
  const { logs, total, providers, logicalModels, loading, refreshing, details, detailLoadingIds, detailErrors, getModelName, loadDetail, refresh, setFilter, filter, expandedId, goToPage, page } = useRequestLogsService()

  const providerOptions = useMemo(() => {
    return providers
      .map(p => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providers])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handlePageChange = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    goToPage(clamped)
  }

  const toggleExpand = (id: string) => {
    loadDetail(expandedId === id ? null : id)
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
          filter={filter}
          providerOptions={providerOptions}
          logicalModels={logicalModels}
          total={total}
          applyFilter={setFilter}
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
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
