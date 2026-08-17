import { Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useRequestLogsService } from './service'
import { RequestRow } from './components/request-row'

export function RequestLogsPage() {
  const { logs, loading, refreshing, errorMessage, refresh } = useRequestLogsService()

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的上游请求，以及每次请求实际使用的模型与失败切换情况"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
            刷新
          </Button>
        }
      />
      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">最近请求</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                加载中…
              </div>
            ) : errorMessage ? (
              <div className="px-4 py-8 text-sm text-destructive">{errorMessage}</div>
            ) : logs.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                暂无请求记录，发送一次代理请求后即可在此看到实际使用的模型。
              </div>
            ) : (
              <div>
                {logs.map(log => (
                  <RequestRow key={log.id} log={log} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContent>
    </PageLayout>
  )
}
