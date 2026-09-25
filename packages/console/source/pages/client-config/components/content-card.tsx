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
  /**
   * 当前要提交的内容：文件原文，或者「模型值写进去之后」的预览。
   *
   * 由上层给而不是自己 `useState`：上方的模型选择改的也是这一段文字，两个入口编辑同一份东西，
   * 各存一半就会出现「上面的选择已经生效、下面的文本还是旧的」这种自相矛盾的状态。
   */
  value: string
  onChange: (content: string) => void
  /** 丢弃全部改动，回到磁盘上的原文——包括上方模型选择带来的那部分。 */
  onDiscard: () => void
  onSave: (content: string) => void
}

/**
 * 文件的**内容**：磁盘上真正躺着的东西，以及即将写回去的东西。
 *
 * 两个来源汇到同一个草稿：上方模型选择算出的预览（地址、密钥由服务端填，界面只决定模型名）
 * 与用户在这里的直接编辑。它们不是两件事——「改模型」就是用另一种方式改这段文字，
 * 所以保存与撤销也只有一套：先存版本、再落盘。
 *
 * 全文对比而不是逐字段 diff：原文是给人读的，行级高亮在这个密度下只会变成噪音。
 */
export function ContentCard(props: ContentCardProps) {
  const { state, saving, value, onChange, onDiscard, onSave } = props
  const t = useTranslation()
  const dirty = value !== state.content

  return (
    <Card>
      <SettingsCardHeader
        icon={<FileCode2 />}
        title={t('clientConfig.content.title')}
        // 卡头报**展开后的真实路径**：这块展示的就是磁盘上的原文，标它真正的落点比标注册表里的 `~/` 写法有用
        // （契约里 `resolvedPath` 的注释也是这个意思）。声明路径另有其处——多文件客户端在「选择配置文件」的下拉里，
        // 同一个串因此在界面上只会说到一次。
        description={<span className="font-mono">{state.resolvedPath}</span>}
        actions={(
          <>
            {/* 撤销同时把上方模型选择拉回文件里的值：它们编辑的是同一段内容，只退一半就不一致了。 */}
            <Button variant="outline" disabled={!dirty || saving} onClick={onDiscard}>
              {t('clientConfig.discard')}
            </Button>
            <Button disabled={!dirty || saving} onClick={() => onSave(value)}>
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
          {/* 文件不在就一律留 `—`：这里报什么都是「没有」，写 0 B 会让人以为文件在那儿但是空的。 */}
          <span>
            {t('clientConfig.content.size')}{' '}
            <span className="font-mono text-text-secondary">
              {state.exists ? formatBytes(state.sizeBytes) : t('clientConfig.emptyValue')}
            </span>
          </span>
          <span>
            {t('clientConfig.content.modified')}{' '}
            <span className="font-mono text-text-secondary">
              {state.modifiedTime ? formatVersionTime(t, state.modifiedTime) : t('clientConfig.emptyValue')}
            </span>
          </span>
        </div>

        <Textarea
          aria-label={t('clientConfig.content.title')}
          className="min-h-72 font-mono"
          placeholder={t('clientConfig.content.placeholder')}
          spellCheck={false}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      </CardContent>
    </Card>
  )
}
