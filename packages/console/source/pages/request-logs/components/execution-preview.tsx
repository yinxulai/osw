import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { TableFrame } from '@/components/table-primitives'
import { useTranslation } from '@/i18n/provider'
import { PREVIEW_DEFAULT_EXPANDED_ID, PREVIEW_LIVE_REQUESTS } from '../lib/preview-fixtures'
import { RequestExecutionRow } from './request-execution-row'
import { RequestLogsTableHeader } from './request-logs-table'

/**
 * 「执行中的请求」那一行的独立预览。
 *
 * 这一行平时只存在于实时推送里，而它真正需要被审视的几种形态（刚路由完、上游回了头却
 * 还没吐字、第一家 429 改试第二家）每次只闪几百毫秒——想看清它长什么样、想改它的设计，
 * 靠真实流量等是等不到的。所以这里把台账**造**出来，让这一行单独铺开。
 *
 * 三件事必须与生产一致，否则据此改设计等于白改：
 * 1. 同一个表头（直接复用 `RequestLogsTableHeader`，列宽列序不分叉）；
 * 2. 同一套行组件（`RequestExecutionRow`，含展开区），不是另写一份简化版；
 * 3. 六种形态是一条请求**真实的推进顺序**，从上往下读就是它在同一条时间线上的六张面孔。
 *
 * 只挂在 `?preview=1` 上、且只在开发构建里可达（见 `page.tsx`）。
 */
export function RequestExecutionPreview() {
  const t = useTranslation()
  const [expandedId, setExpandedId] = useState<string | null>(PREVIEW_DEFAULT_EXPANDED_ID)

  return (
    <PageLayout className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('requestLogs.preview.title')}
        description={t('requestLogs.preview.description')}
        titleAdornment={(
          <span className="inline-flex items-center gap-1.5 rounded-md bg-inset px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
            <FlaskConical size={11} aria-hidden />
            {t('requestLogs.preview.badge')}
          </span>
        )}
      />
      <PageContent className="flex min-h-0 flex-1 flex-col">
        <TableFrame className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <RequestLogsTableHeader />
              <tbody>
                {PREVIEW_LIVE_REQUESTS.map(live => (
                  <RequestExecutionRow
                    key={live.id}
                    live={live}
                    expanded={expandedId === live.id}
                    modelName={t('requestLogs.preview.logicalModelName')}
                    modelDeleted={false}
                    toggleExpand={id => setExpandedId(current => (current === id ? null : id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </TableFrame>
        <p className="system-xs-regular text-text-tertiary">{t('requestLogs.preview.hint')}</p>
      </PageContent>
    </PageLayout>
  )
}
