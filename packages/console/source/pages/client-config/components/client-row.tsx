import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ClientConfigOverviewItem } from '@common/client-config'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { AGENT_CLIENT_DEFINITION_BY_KEY } from '@/catalog/clients'
import { routePaths } from '@/routing/routes'
import { ClientIcon } from './client-icon'
import { CoverageBadge } from './coverage-badge'
import { formatVersionTime } from '../lib/relative-time'

interface ClientRowProps {
  item: ClientConfigOverviewItem
  /** 有任意一次一键生效在跑：此刻不允许再点，避免两个写请求交叉改同一个文件。 */
  busy: boolean
  onFill: () => void
}

/**
 * 列表里的一个客户端。
 *
 * 左侧整块是**进入详情**的入口（图标 + 名字 + 文件路径），右侧是这一行的三个事实与一个动作。
 * 把事实放在链接里是为了让「点了会去哪」和「这一行是什么」是同一块区域；
 * 动作按钮必须在链接外——`<button>` 不能嵌在 `<a>` 里，那样点击也会被导航吃掉。
 *
 * 事实用「标签在上、值在下」的两行格子（`Fact`）：这几个值没有单位也不同量纲，
 * 平铺成一行纯数字会读成一句话，竖着摆才像一张表的列。
 */
export function ClientRow(props: ClientRowProps) {
  const { item, busy, onFill } = props
  const t = useTranslation()
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[item.clientKey]
  const disabled = busy || item.coverage === 'unavailable'

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Link
        to={routePaths.clientConfigDetail}
        params={{ clientKey: item.clientKey }}
        className="group -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-state-base-hover"
      >
        <ClientIcon clientKey={item.clientKey} size={20} />
        <div className="min-w-0 flex-1">
          <div className="truncate system-sm-medium text-text-primary">{client?.name ?? item.clientKey}</div>
          <div className="truncate font-mono system-2xs-regular text-text-quaternary">{item.filePath}</div>
        </div>

        <div className="hidden shrink-0 items-start gap-6 pl-2 sm:flex">
          <Fact label={t('clientConfig.list.coverage')}>
            <CoverageBadge autoFill={item.autoFill} coverage={item.coverage} pendingChanges={item.pendingChanges} />
          </Fact>
          <Fact label={t('clientConfig.list.modified')}>
            {item.modifiedTime === null ? t('clientConfig.emptyValue') : formatVersionTime(t, item.modifiedTime)}
          </Fact>
          <Fact label={t('clientConfig.list.versions')}>
            {item.versionCount === 0 ? t('clientConfig.emptyValue') : String(item.versionCount)}
          </Fact>
        </div>

        <ChevronRight className="size-4 shrink-0 text-text-quaternary transition-colors group-hover:text-text-secondary" aria-hidden />
      </Link>

      {/* 不支持自动填充的客户端连按钮都不给：「点了没反应」比没有按钮更让人困惑。 */}
      {item.coverage !== 'unavailable' && (
        <Button variant="outline" size="sm" disabled={disabled} onClick={onFill}>
          {t('clientConfig.fill.one')}
        </Button>
      )}
    </li>
  )
}

interface FactProps {
  label: string
  children: ReactNode
}

/** 表格式的一列：上标签、下值，宽度固定好让每一行的三列对齐。 */
function Fact(props: FactProps) {
  return (
    <div className="w-24">
      <div className="system-2xs-regular text-text-quaternary">{props.label}</div>
      <div className="mt-0.5 flex items-center system-xs-regular text-text-secondary">{props.children}</div>
    </div>
  )
}
