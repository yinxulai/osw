import type { ClientConfigVersionOrigin, ClientConfigVersionSummary } from '@common/client-config'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'
import { formatVersionTime } from '../lib/relative-time'

interface HistoryCardProps {
  versions: ClientConfigVersionSummary[]
  loading: boolean
  /** 磁盘上当前内容的摘要，用来标出「这一版就是现在的内容」。 */
  currentHash: string
  restoringId: string | null
  onRestore: (id: string) => void
}

/**
 * 版本历史。
 *
 * 「每次提交前自动存一份、内容一样就不重复存」这条规则是这一页的兜底：自动覆盖别人的配置文件
 * 是件必须能退回去的事，所以历史不是可选的附加功能，而是和写入同一次发生。
 *
 * 每行只给判断去留所需的事实：什么时候、为什么存的、多大、开头长什么样。`origin` 用词说明
 * 「这一版是谁的旧样子」——是自动填充前、手动保存前，还是被别的回退覆盖前，
 * 这三种情况用户要不要退回它，判断完全不同。
 */
export function HistoryCard(props: HistoryCardProps) {
  const { versions, loading, currentHash, restoringId, onRestore } = props
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader icon={<History />} title={t('clientConfig.history.title')} description={t('clientConfig.history.description')} />

      {loading && versions.length === 0 ? (
        <CardContent className="space-y-2 px-4 pt-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      ) : versions.length === 0 ? (
        /* 空状态只报「还没有」这一件事：卡片头刚说过的话不再重复一遍。 */
        <EmptyState embedded icon={History} title={t('clientConfig.history.empty')} />
      ) : (
        <CardContent className="px-4">
          <ul className="divide-y divide-border/50">
            {versions.map(version => {
              const current = version.contentHash === currentHash
              return (
                <li key={version.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('system-sm-medium', current ? 'text-text-tertiary' : 'text-text-primary')}>
                        {formatVersionTime(t, version.createdTime)}
                      </span>
                      <span className="system-2xs-medium text-text-quaternary">{t(ORIGIN_KEYS[version.origin])}</span>
                      <span className="font-mono system-2xs-regular text-text-quaternary">{formatBytes(version.sizeBytes)}</span>
                      {current && <span className="system-2xs-medium text-text-tertiary">{t('clientConfig.history.current')}</span>}
                    </div>
                    <p className="mt-0.5 truncate font-mono system-xs-regular text-text-quaternary">{firstLine(version.preview)}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={current || restoringId !== null}
                    onClick={() => onRestore(version.id)}
                  >
                    {restoringId === version.id ? t('clientConfig.restoring') : t('clientConfig.history.restore')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  )
}

const ORIGIN_KEYS: Record<ClientConfigVersionOrigin, UiCatalogKey> = {
  apply: 'clientConfig.history.origin.apply',
  manual: 'clientConfig.history.origin.manual',
  restore: 'clientConfig.history.origin.restore',
}

/** 版本预览只显示第一行：那份内容是给人「瞄一眼」的，多行预览会把行高撑开、列表失去节奏。 */
function firstLine(preview: string): string {
  const line = preview.split('\n')[0] ?? ''
  return line.trim() === '' ? '…' : line
}
