import { useState } from 'react'
import { FileCode2 } from 'lucide-react'
import type { ClientConfigFileState } from '@common/client-config'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/provider'
import { formatBytes } from '@/lib/format-bytes'
import { formatVersionTime } from '../lib/relative-time'

interface ContentCardProps {
  state: ClientConfigFileState
  saving: boolean
  onSave: (content: string) => void
}

/**
 * 文件的**原文**。
 *
 * 这一页的另一半是「按本机服务改写」（地址与密钥由服务端填，界面只决定模型名）——那是替用户写；
 * 写不了、或者用户要自己改的场合，就得让他看到磁盘上真正躺着什么。所以这里渲染的是文件全文，
 * 和自动填充共用同一份备份与版本：手动保存走的是同一条「先存版本、再落盘」的路。
 *
 * 改动只在本地草稿里累积，`dirty` 才亮起保存/撤销。全文对比而不是逐字段 diff：
 * 原文是给人读的，行级高亮在这个密度下只会变成噪音。
 */
export function ContentCard(props: ContentCardProps) {
  const { state, saving, onSave } = props
  const t = useTranslation()
  const [draft, setDraft] = useState(state.content)
  const dirty = draft !== state.content

  return (
    <Card>
      <SettingsCardHeader
        icon={<FileCode2 />}
        title={t('clientConfig.content.title')}
        description={state.filePath}
        actions={(
          <>
            <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(state.content)}>
              {t('clientConfig.discard')}
            </Button>
            <Button disabled={!dirty || saving} onClick={() => onSave(draft)}>
              {saving ? t('clientConfig.saving') : t('clientConfig.saveContent')}
            </Button>
          </>
        )}
      />

      <CardContent className="space-y-2 px-4 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 system-xs-regular text-text-tertiary">
          <span className={state.exists ? undefined : 'text-text-quaternary'}>
            {state.exists ? t('clientConfig.content.exists') : t('clientConfig.content.missing')}
          </span>
          <span>
            {t('clientConfig.content.size')} <span className="font-mono text-text-secondary">{formatBytes(state.sizeBytes)}</span>
          </span>
          <span>
            {t('clientConfig.content.modified')}{' '}
            <span className="font-mono text-text-secondary">
              {state.modifiedTime ? formatVersionTime(t, state.modifiedTime) : t('clientConfig.emptyValue')}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            {t('clientConfig.content.path')}
            <span className="min-w-0 truncate font-mono text-text-secondary">{state.resolvedPath}</span>
          </span>
        </div>

        <Textarea
          aria-label={t('clientConfig.content.title')}
          className="min-h-72 font-mono"
          placeholder={t('clientConfig.content.placeholder')}
          spellCheck={false}
          value={draft}
          onChange={event => setDraft(event.target.value)}
        />
      </CardContent>
    </Card>
  )
}
