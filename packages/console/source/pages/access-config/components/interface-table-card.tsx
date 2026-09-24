import { useNavigate } from '@tanstack/react-router'
import { ListTree, ScrollText } from 'lucide-react'
import { PROTOCOL_DISPLAY_NAMES, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'
import { INTERFACE_DESCRIPTION_KEYS } from '../service-facts'

/**
 * 本服务的接口面：一张「哪些路径会被受理」的表。
 *
 * 表的内容全部来自契约层的 `PROXY_INTERFACE_ENTRIES`，那份清单由代理注册表的一致性测试守着
 * （`packages/core/source/proxy/protocols/interface-surface.test.ts`）。这是这一页敢用
 * 「说明书」形态的前提：它写的是我们自己的实现事实，不会因为谁改了界面而过期，
 * 也不需要在这里维护第二份路径清单。
 *
 * 页面上**不列任何工具的名字**：工具的产品名、菜单路径、字段叫法都由别人定义、随时会变，
 * 追着它们更新等于把维护成本建在别人的排期上。这里只回答「服务对外长什么样」，
 * 用户拿这三个事实去对任何一种客户端都成立。
 */
export function InterfaceTableCard() {
  const t = useTranslation()
  const navigate = useNavigate()

  return (
    <Card className="pb-0">
      <SettingsCardHeader
        icon={<ListTree />}
        title={t('access.interface.title')}
        description={t('access.interface.description')}
      />
      <CardContent className="p-0">
        <ul className="divide-y divide-border/50 border-t border-border/50">
          {PROXY_INTERFACE_ENTRIES.map(entry => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="w-9 shrink-0 font-mono system-2xs-medium text-text-tertiary">
                {entry.method}
              </span>
              <span className="font-mono system-sm-medium text-text-primary">{entry.paths[0]}</span>
              {/* 等价写法排在主写法后面：服务端两种都受理，说清楚是为了让用户不必猜别人的实现。 */}
              {entry.paths.slice(1).map(path => (
                <span key={path} className="font-mono system-xs-regular text-text-quaternary">
                  {path}
                </span>
              ))}
              <span className="ml-auto flex flex-wrap items-baseline gap-x-2">
                <span className="system-xs-regular text-text-tertiary">
                  {t(INTERFACE_DESCRIPTION_KEYS[entry.id])}
                </span>
                <span className="system-2xs-regular text-text-quaternary">
                  {entry.protocol ? PROTOCOL_DISPLAY_NAMES[entry.protocol] : t('access.interface.localResponse')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>

      {/* 收尾只留一件事：怎么知道自己接上了。不放示例命令——那是「谁的写法」的问题，
          这一页不碰；请求记录里有没有这条请求是客观的，且不需要再多一个字段。 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/50 px-4 py-3">
        <span className="min-w-0 system-xs-regular text-text-tertiary">
          {t('access.interface.verifyHint')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => void navigate({ to: routePaths.requestLogs })}
        >
          <ScrollText />
          {t('access.interface.openLogs')}
        </Button>
      </div>
    </Card>
  )
}
