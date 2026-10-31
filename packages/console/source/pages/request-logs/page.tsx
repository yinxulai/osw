import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { TablePager } from '@/components/table-primitives'
import { useTranslation } from '@/i18n/provider'
import { RequestLogsFilters } from './components/request-logs-filters'
import { RequestLogsTable } from './components/request-logs-table'
import { RequestExecutionPreview } from './components/execution-preview'
import { isExecutionPreviewRequested } from './lib/preview-flag'
import { PAGE_SIZE } from './queries'
import { useRequestLogsService } from './service'

export function RequestLogsPage() {
  const t = useTranslation()
  /**
   * `?preview=1` 把「执行中的请求」那一行单独铺开（见 `execution-preview.tsx`）。
   *
   * 它是设计与排版的观察窗，不是一个功能：真实形态只闪几百毫秒，靠线上流量根本看不清。
   * 因此两重限制：只在开发构建里可达（打包后带着这个参数进来也照常显示台账），
   * 且只在首次进入时读一次（不需要改参数就重渲染整页）。
   */
  const [preview] = useState(() => import.meta.env.DEV === true && isExecutionPreviewRequested(window.location.href))
  const { rows, total, providerModelOptions, loading, refreshing, error, filtered, details, detailLoadingIds, detailErrors, getModelName, isModelDeleted, loadDetail, refresh, setFilter, filter, expandedId, goToPage, page } = useRequestLogsService()

  if (preview) {
    return <RequestExecutionPreview />
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handlePageChange = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    goToPage(clamped)
  }

  const toggleExpand = (id: string) => {
    loadDetail(expandedId === id ? null : id)
  }

  return (
    <PageLayout className="flex h-full min-h-0 flex-col">
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
      <PageContent className="flex min-h-0 flex-1 flex-col">
        {/* 进行中的请求就在下面这张表里：同一张表先说「现在」，再说「过去」。 */}
        <RequestLogsFilters
          filter={filter}
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
          isModelDeleted={isModelDeleted}
          toggleExpand={toggleExpand}
          onRetry={() => void refresh()}
        />
        {!loading && totalPages > 1 && <TablePager page={page} totalPages={totalPages} onPageChange={handlePageChange} />}
      </PageContent>
    </PageLayout>
  )
}
