import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { LogsTable } from './components/logs-table'
import { LogsToolbar } from './components/logs-toolbar'
import { useLogsModel } from './hooks/use-logs-model'

export function LogsPage() {
  const model = useLogsModel()
  return (
    <PageLayout>
      <PageHeader
        title="运行日志"
        description="本次进程运行期间的服务日志，用于实时观察和故障排查"
      />
      <PageContent>
        <LogsToolbar count={model.filteredLogs.length} total={model.logs.length} live={model.live} refreshing={model.refreshing} levelFilter={model.levelFilter} searchText={model.searchText} clearDialogOpen={model.clearDialogOpen} onLiveChange={() => model.setLive(value => !value)} onRefresh={() => void model.refresh()} onExport={() => void model.exportLogs()} onClear={() => void model.clearLogs()} onDialogChange={model.setClearDialogOpen} onLevelChange={model.setLevelFilter} onSearchChange={model.setSearchText} />
        <LogsTable logs={model.filteredLogs} loading={model.loading} />
      </PageContent>
    </PageLayout>
  )
}
