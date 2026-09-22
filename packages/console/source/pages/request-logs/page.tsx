import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { TablePager } from '@/components/table-primitives'
import { useTranslation } from '@/i18n/provider'
import { RequestLogsFilters } from './components/request-logs-filters'
import { RequestLogsTable } from './components/request-logs-table'
import { PAGE_SIZE } from './queries'
import { useRequestLogsService } from './service'

export function RequestLogsPage() {
  const t = useTranslation()
  const { rows, total, providerOptions, providerModelOptions, loading, refreshing, error, filtered, details, detailLoadingIds, detailErrors, getModelName, loadDetail, refresh, setFilter, filter, expandedId, goToPage, page } = useRequestLogsService()

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
        title={t('requestLogs.title')}
        description={t('requestLogs.description')}
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            {t('common.action.refresh')}
          </Button>
        }
      />
      <PageContent>
        {/* 进行中的请求就在下面这张表里：同一张表先说「现在」，再说「过去」。 */}
        <RequestLogsFilters
          filter={filter}
          providerOptions={providerOptions}
          providerModelOptions={providerModelOptions}
          total={total}
          applyFilter={setFilter}
        />
        <RequestLogsTable
          rows={rows}
          loading={loading}
          error={error}
          filtered={filtered}
          expandedId={expandedId}
          details={details}
          detailLoadingIds={detailLoadingIds}
          detailErrors={detailErrors}
          getModelName={getModelName}
          toggleExpand={toggleExpand}
          onRetry={() => void refresh()}
        />
        {!loading && totalPages > 1 && <TablePager page={page} totalPages={totalPages} onPageChange={handlePageChange} />}
      </PageContent>
    </PageLayout>
  )
}
