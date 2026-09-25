import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ClientConfigOverviewItem } from '@common/client-config'
import { useTranslation } from '@/i18n/provider'
import { AGENT_CLIENT_DEFINITION_BY_KEY } from '@/catalog/clients'
import { routePaths } from '@/routing/routes'
import { cn } from '@/lib/utils'
import { ClientIcon } from './client-icon'
import { CoverageBadge } from './coverage-badge'
import { formatVersionTime } from '../lib/relative-time'

/**
 * 列表的列模板。**表头与每一行共用同一份**，列才会落在同一条竖线上。
 *
 * 三列事实（配置状态 / 最近更新 / 历史版本）给固定宽：它们的内容长度不随客户端变化，
 * 定死之后每行的徽标、时间、版本数才会对齐；名字列吃掉剩下的宽度。
 * 窄屏（< md）只留「名字 + 箭头」两列——注册表里最长的路径有 33 个字符，
 * 再加三列事实在这个宽度里只会挤成一团，整块消失比压扁了更好读。
 */
export const CLIENT_ROW_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-3 md:grid-cols-[minmax(0,1fr)_9rem_7.5rem_5rem_1.5rem]'

interface ClientRowProps {
  item: ClientConfigOverviewItem
}

/**
 * 列表里的一个客户端。
 *
 * 整行就是**进入详情**的入口（图标 + 名字 + 路径 + 三列事实 + 箭头）。
 * 这里不再摆「一键生效」：这一页的一键生效是**页面级**的一颗（标题栏那颗），
 * 逐行再来一颗，同一件事就有两种入口，而这一页真正要下钻的是「这一行到底改了什么」。
 * 单个客户端的生效在详情页里，那里能看到它要改的那几行。
 *
 * 三列事实**不带标签**：标签已经收进表头（`ClientListHeader`）只说一次。
 * 旧版把「配置状态 / 最近更新 / 历史版本」三个小标签印在**每一行**里，
 * 八行就等于把同一句话重复了 24 遍——这是这一版换掉它的唯一理由。
 */
export function ClientRow(props: ClientRowProps) {
  const { item } = props
  const t = useTranslation()
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[item.clientKey]

  return (
    <li className="transition-colors hover:bg-state-base-hover">
      <Link
        to={routePaths.clientConfigDetail}
        params={{ clientKey: item.clientKey }}
        className={cn('min-w-0 px-4 py-2.5', CLIENT_ROW_COLUMNS)}
      >
        <div className="flex min-w-0 items-center gap-3">
          <ClientIcon clientKey={item.clientKey} size={20} />
          <div className="min-w-0">
            <div className="truncate system-sm-medium text-text-primary">{client?.name ?? item.clientKey}</div>
            <div className="truncate font-mono system-2xs-regular text-text-quaternary">{item.filePath}</div>
          </div>
        </div>

        <div className="hidden md:block">
          <CoverageBadge autoFill={item.autoFill} coverage={item.coverage} pendingChanges={item.pendingChanges} />
        </div>
        {/* 空值一律 `—`：布局不随数据有无而变，有值的行也不该重排。 */}
        <div className="hidden system-xs-regular text-text-secondary md:block">
          {item.modifiedTime === null
            ? <span className="text-text-quaternary">{t('clientConfig.emptyValue')}</span>
            : formatVersionTime(t, item.modifiedTime)}
        </div>
        <div className="hidden system-xs-regular tabular-nums text-text-secondary md:block">
          {item.versionCount === 0
            ? <span className="text-text-quaternary">{t('clientConfig.emptyValue')}</span>
            : item.versionCount}
        </div>

        <ChevronRight className="size-4 justify-self-end text-text-quaternary" aria-hidden />
      </Link>
    </li>
  )
}

/**
 * 列表表头：列标签的**唯一**出处。
 *
 * 结构必须与 `ClientRow` 逐字对齐（同一个网格 + 同一份左右留白），
 * 否则表头会跟数据行错开——所以两处都引用 `CLIENT_ROW_COLUMNS`，不各写一遍。
 * 窄屏整条藏起来：那时行里本来就没有这三列。
 */
export function ClientListHeader() {
  const t = useTranslation()
  const labelClass = 'system-2xs-medium text-text-tertiary'

  return (
    <div className="hidden border-b border-border/50 md:block">
      <div className={cn('min-w-0 px-4 py-2', CLIENT_ROW_COLUMNS)}>
        {/* 名字列没有标签：图标 + 名字自己就说明了这一列是什么。 */}
        <span />
        <span className={labelClass}>{t('clientConfig.list.coverage')}</span>
        <span className={labelClass}>{t('clientConfig.list.modified')}</span>
        <span className={labelClass}>{t('clientConfig.list.versions')}</span>
        <span />
      </div>
    </div>
  )
}
