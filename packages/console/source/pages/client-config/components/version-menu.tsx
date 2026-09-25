import type { ClientConfigVersionDiff, ClientConfigVersionEntry, ClientConfigVersionOrigin } from '@common/client-config'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'
import { formatVersionTime } from '../lib/relative-time'

interface VersionMenuProps {
  versions: ClientConfigVersionEntry[]
  loading: boolean
  /** 磁盘上当前内容的摘要，用来标出「这一版就是现在的内容」。 */
  currentHash: string
  restoringId: string | null
  onRestore: (id: string) => void
}

/**
 * 版本历史：页头右上角、「一键生效」右边那枚图标按钮，点开是一列旧内容
 * （与 `pages/router/components/version-menu.tsx` 同一个式子）。
 *
 * 它原来铺在页面最下面一张整卡里——一屏里最不常看的东西占了最大一块版面。后来挪到内容卡的
 * 卡头、现在挪到页头：卡头是「这一块内容」的地方，而历史连手动保存和自动填充一起管，
 * 它不属于任何一块内容，它是整页的退路，因此和一键生效待在同一个层级的右上角。
 * 不点开不占地方，点开就是那一列旧内容。
 *
 * 「每次提交前自动存一份、内容一样就不重复存」这条规则是这一页的兜底：自动覆盖别人的配置文件
 * 是件必须能退回去的事，所以历史不是可选的附加功能，而是和写入同一次发生。
 *
 * 每行只给判断去留所需的事实：什么时候、为什么存的、多大、回退到它之后文件里会变的是哪几行。`origin` 用词说明
 * 「这一版是谁的旧样子」——是自动填充前、手动保存前，还是被别的回退覆盖前，
 * 这三种情况用户要不要退回它，判断完全不同。整行可点即回退（浮层里没有第二颗按钮的位置）。
 *
 * 末尾那一行从前是这一版开头的若干字符，而配置文件的开头永远是一个 `{`——八条历史长得一模一样，
 * 谁也没说出自己是什么。换成**与当前文件的差异**后，这一行才真的回答了「退回它会让文件变成什么样」。
 * 差异由服务端算（那边同时握着这一版和当前文件的内容，见 `client-config/version-diff.ts`）。
 */
export function VersionMenu(props: VersionMenuProps) {
  const { versions, loading, currentHash, restoringId, onRestore } = props
  const t = useTranslation()

  return (
    <DropdownMenu>
      {/*
        触发器只放一枚图标：它左手边就是写着「一键生效」的那颗按钮，再写一遍「历史版本」
        会让页头排成两颗带字的按钮、看不出主次。图标按钮 + `title` 足够说清它是什么。
      */}
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('clientConfig.history.title')} title={t('clientConfig.history.title')}>
          <History />
        </Button>
      </DropdownMenuTrigger>

      {/*
        浮层宽度必须自己钉死：`DropdownMenuContent` 默认跟随触发器宽度（一枚 32px 的方块），
        两行文案会被挤成一列（同 `model-test-panel.tsx` 里那处注释）。
      */}
      <DropdownMenuContent align="end" sideOffset={6} className="w-96 min-w-96">
        <DropdownMenuLabel className="flex flex-col items-stretch gap-1 px-2 py-1.5">
          <span className="flex items-center gap-1.5 system-xs-medium text-text-tertiary">
            <History className="size-3.5" aria-hidden />
            {t('clientConfig.history.title')}
            <span className="ml-auto system-2xs-regular text-text-quaternary">{t('clientConfig.history.count', { count: versions.length })}</span>
          </span>
          <span className="system-2xs-regular text-text-quaternary">{t('clientConfig.history.description')}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-components-panel-border" />

        {loading && versions.length === 0 && (
          <div className="space-y-1 p-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!loading && versions.length === 0 && (
          <div className="px-2 py-3 system-xs-regular text-text-tertiary">{t('clientConfig.history.empty')}</div>
        )}

        {versions.map(version => {
          const current = version.contentHash === currentHash
          const restoring = restoringId === version.id
          const summary = summarizeDiff(version.diff)
          return (
            <DropdownMenuItem
              key={version.id}
              // 正躺着的那一版没什么可退的；另一次回退正在跑的时候也要按住，两个请求不能交叉改同一个文件。
              disabled={current || restoringId !== null}
              onSelect={() => onRestore(version.id)}
              className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
            >
              <span className="flex items-center gap-2">
                <span className={cn('shrink-0 system-xs-medium', current ? 'text-text-tertiary' : 'text-text-primary')}>
                  {formatVersionTime(t, version.createdTime)}
                </span>
                <span className="shrink-0 system-2xs-medium text-text-quaternary">{t(ORIGIN_KEYS[version.origin])}</span>
                <span className="ml-auto shrink-0 font-mono system-2xs-regular text-text-quaternary">{formatBytes(version.sizeBytes)}</span>
                <span className={cn('shrink-0 system-2xs-medium', current ? 'text-text-quaternary' : 'text-text-tertiary')}>
                  {current ? t('clientConfig.history.current') : restoring ? t('clientConfig.restoring') : t('clientConfig.history.restore')}
                </span>
              </span>
              <span className="flex flex-col">
                {summary.lines.length === 0 && <span className="system-2xs-regular text-text-quaternary">{t('clientConfig.history.unchanged')}</span>}
                {summary.lines.map((line, index) => (
                  <span key={index} className="flex items-center gap-1">
                    <span className={cn('shrink-0 font-mono system-2xs-medium', line.sign === '+' ? 'text-text-success' : 'text-text-destructive')}>{line.sign}</span>
                    <span className="min-w-0 truncate font-mono system-2xs-regular text-text-secondary">{line.text}</span>
                  </span>
                ))}
                {summary.more > 0 && (
                  <span className="system-2xs-regular text-text-quaternary">{t('clientConfig.history.diffMore', { count: summary.more })}</span>
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ORIGIN_KEYS: Record<ClientConfigVersionOrigin, UiCatalogKey> = {
  apply: 'clientConfig.history.origin.apply',
  manual: 'clientConfig.history.origin.manual',
  restore: 'clientConfig.history.origin.restore',
}

/** 摆得下的差异行数：菜单每行都在抢垂直空间，摆不下就用末尾那句「另有 N 行」交待。 */
const MAX_VISIBLE_DIFF_LINES = 3

interface VersionDiffLine {
  sign: '+' | '-'
  text: string
}

/** 一处差异最多摊成两行：`-` 是回退后会消失的当前内容，`+` 是回退后会出现的这一版内容。 */
function summarizeDiff(diff: ClientConfigVersionDiff[]): { lines: VersionDiffLine[]; more: number } {
  const lines: VersionDiffLine[] = []
  for (const item of diff) {
    if (item.before !== null) lines.push({ sign: '-', text: item.before })
    if (item.after !== null) lines.push({ sign: '+', text: item.after })
  }
  return { lines: lines.slice(0, MAX_VISIBLE_DIFF_LINES), more: Math.max(0, lines.length - MAX_VISIBLE_DIFF_LINES) }
}
