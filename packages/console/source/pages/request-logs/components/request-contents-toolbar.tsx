import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/provider'

export interface RequestContentsToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  /** 命中之间前后跳：`-1` 上一条、`1` 下一条。 */
  onJump: (delta: number) => void
  /** 去掉空白后的搜索词；为空表示当前没有在搜。 */
  searchQuery: string
  /** 当前激活的命中序号（全局，从 0 起）。 */
  activeMatchIndex: number
  totalMatches: number
  /** 正文还在路上：此时不给「没有命中」这类结论。 */
  loading: boolean
  /** 有可展开的阶段才让「全部展开 / 收起」可用。 */
  expandable: boolean
  onExpandAll: () => void
  onCollapseAll: () => void
}

/**
 * 正文面板的搜索条。
 *
 * 只负责把「输入了什么」「跳到哪一条」「全部展开 / 收起」这三件事转成回调；
 * 搜索本身的高亮与命中列表由宿主的 `searchBlocks` 算好传进来（见 `RequestContentsSheet`）。
 */
export function RequestContentsToolbar(props: RequestContentsToolbarProps) {
  const t = useTranslation()

  return (
    <div className="sticky top-0 z-10 bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <Input
            aria-label={t('requestLogs.contents.searchAria')}
            value={props.search}
            onChange={event => props.onSearchChange(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              props.onJump(event.shiftKey ? -1 : 1)
            }}
            placeholder={t('requestLogs.contents.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        {props.searchQuery && !props.loading && (
          <span
            aria-live="polite"
            className="shrink-0 font-mono system-2xs-regular tabular-nums text-text-tertiary"
          >
            {props.totalMatches === 0 ? t('requestLogs.contents.noMatch') : `${props.activeMatchIndex + 1}/${props.totalMatches}`}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t('requestLogs.contents.previousMatch')}
          title={t('requestLogs.contents.previousMatchTitle')}
          disabled={props.totalMatches === 0 || props.loading}
          onClick={() => props.onJump(-1)}
        >
          <ChevronUp size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t('requestLogs.contents.nextMatch')}
          title={t('requestLogs.contents.nextMatchTitle')}
          disabled={props.totalMatches === 0 || props.loading}
          onClick={() => props.onJump(1)}
        >
          <ChevronDown size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!props.expandable}
          onClick={props.onExpandAll}
        >
          {t('requestLogs.contents.expandAll')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!props.expandable}
          onClick={props.onCollapseAll}
        >
          {t('requestLogs.contents.collapseAll')}
        </Button>
      </div>
    </div>
  )
}
