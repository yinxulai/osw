import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { LogsTable } from './components/logs-table'
import { LogsToolbar } from './components/logs-toolbar'
import { useLogsModel } from './hooks/use-logs-model'

interface LogsPageProps {
  q?: string
}

export function LogsPage(props: LogsPageProps) {
  const model = useLogsModel(props.q)
  const totalPages = model.totalPages
  const showPager = !model.loading && model.total > model.pageSize

  const handlePageChange = (next: number) => {
    model.goToPage(next)
  }

  return (
    <PageLayout>
      <PageHeader
        title="运行日志"
        description="本次进程运行期间的服务日志，用于实时观察和故障排查"
      />
      <PageContent>
        <LogsToolbar total={model.total} live={model.live} refreshing={model.refreshing} levelFilter={model.levelFilter} searchText={model.searchText} clearDialogOpen={model.clearDialogOpen} onLiveChange={() => model.setLive(value => !value)} onRefresh={() => void model.refresh()} onExport={() => void model.exportLogs()} onClear={() => void model.clearLogs()} onDialogChange={model.setClearDialogOpen} onLevelChange={model.setLevelFilter} onSearchChange={model.setSearchText} />
        <LogsTable logs={model.logs} loading={model.loading} />
        {showPager && (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-foreground/75">
            <span>
              第 {model.page} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={model.page <= 1}
              onClick={() => handlePageChange(model.page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={model.page >= totalPages}
              onClick={() => handlePageChange(model.page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
