import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import type { TableSortDirection } from '@/lib/table-sort'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

export const tableHeaderClass = 'border-b border-border/50 bg-inset text-left system-2xs-medium text-text-tertiary'
export const tableHeaderCellClass = 'px-3 py-2 font-medium'
export const tableCellClass = 'px-3 py-2.5'
export const tableRowClass = 'border-b border-border/40 transition-colors last:border-0 hover:bg-state-base-hover'

interface TableFrameProps {
  children: ReactNode
  className?: string
}

interface TablePagerProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

export function TableFrame(props: TableFrameProps) {
  return <div className={cn('overflow-hidden rounded-lg border border-module-border bg-card', props.className)}>{props.children}</div>
}

export function TableViewport(props: TableFrameProps) {
  return <div className={cn('overflow-x-auto', props.className)}>{props.children}</div>
}

export function TableHeaderSurface(props: TableFrameProps) {
  return <div className={cn(tableHeaderClass, props.className)}>{props.children}</div>
}

/** 表格分页条：请求记录、运行日志这类长列表共用同一套翻页控件与计数排版。 */
export function TablePager(props: TablePagerProps) {
  const t = useTranslation()
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="system-xs-regular text-text-tertiary">{t('common.pagination.page', { page: props.page, totalPages: props.totalPages })}</span>
      <Button variant="outline" size="icon-sm" aria-label={t('common.pagination.previous')} disabled={props.disabled === true || props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>
        <ChevronLeft size={14} />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label={t('common.pagination.next')} disabled={props.disabled === true || props.page >= props.totalPages} onClick={() => props.onPageChange(props.page + 1)}>
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}

export interface SortableHeaderProps {
  /** 表头文案，同时也是无障碍名的填充值。 */
  label: string
  /** 这一列是否正在参与排序。 */
  active: boolean
  /** 仅在 `active` 时有意义。 */
  direction: TableSortDirection
  onSort: () => void
  /** 单元格自身的类：只放对齐、字体、宽度，**不要放内边距**（内边距归按钮，见 `contentClassName`）。 */
  className?: string
  /** 按钮的类：需要与表体单元格同宽的内边距时在这里补，例如末列的 `px-4`。 */
  contentClassName?: string
  /** 文字与图标贴哪边：跟随该列的对齐方向，`end` 用于右对齐的数值列。 */
  align?: 'start' | 'end'
}

/**
 * 可排序的表头单元格。
 *
 * 三处讲究：
 * 1. 整格可点。指示图标只有 12px，做成按钮就是让人瞄着它点；按钮铺满整个单元格后，点哪儿都算。
 * 2. 位置固定。没在排序的列也占着图标的位置，只有当前列把图标点亮——否则点击时表头宽度会跳。
 * 3. 内边距只在按钮上。按钮在流内铺满单元格，由它决定单元格高度；`<th>` 若再给一份内边距，
 *    两边叠起来就是双倍缩进，表头会比表体明显往里缩。
 */
export function SortableHeader(props: SortableHeaderProps) {
  const t = useTranslation()
  const Icon = props.active ? (props.direction === 'ascending' ? ArrowUp : ArrowDown) : ChevronsUpDown

  return (
    <th scope="col" className={props.className} aria-sort={props.active ? props.direction : 'none'}>
      <button
        type="button"
        aria-label={t('common.table.sort.aria', { column: props.label })}
        title={t('common.table.sort.hint')}
        onClick={props.onSort}
        className={cn(
          'group/header flex w-full items-center gap-1 px-3 py-2',
          // 按钮带 13.333px 的 UA 字号，不继承就会把表头的字号字重一起冲掉。
          '[font:inherit]',
          // 表头底色比卡片深一档，聚焦环缩进去画一圈，才不会被单元格裁掉。
          'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-state-accent-solid',
          props.align === 'end' && 'flex-row-reverse',
          props.contentClassName,
        )}
      >
        <span className="truncate">{props.label}</span>
        <Icon size={12} className={cn('shrink-0', props.active ? 'text-text-primary' : 'opacity-40 group-hover/header:opacity-70')} />
      </button>
    </th>
  )
}
