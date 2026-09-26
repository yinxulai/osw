import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, ChevronDown, ListTree } from 'lucide-react'
import { PROTOCOL_DISPLAY_NAMES, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { INTERFACE_DESCRIPTION_KEYS } from './interface-entries'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { SettingsCardHeader } from './settings-card-header'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'

interface InterfaceTableCardProps {
  /**
   * `'card'`（默认）：自己就是一张卡（卡头 + 可折叠的路径清单 + 收尾行）。
   * `'flat'`：只出折叠区与收尾行，由调用方把它放进自己的卡里。
   *
   * 两个形态的差别只有外壳：清单内容、折叠状态、收尾行完全同一份实现。
   * 引导页用 `'card'`——那一步几块内容平级，它就是其中一块；
   * 客户端配置页用 `'flat'`——那一页正文是客户端列表，接口面属于「参考」，
   * 要和地址卡合成一张卡摆在一起（见 `page.tsx`），这时再来一层卡边框就是双重嵌套。
   */
  variant?: 'card' | 'flat'
}

/**
 * 本服务的接口面：一张「哪些路径会被受理」的表，默认收起成一行。
 *
 * 表的内容全部来自契约层的 `PROXY_INTERFACE_ENTRIES`，那份清单由代理注册表的一致性测试守着
 * （`packages/core/source/proxy/protocols/interface-surface.test.ts`）。这是这一页敢用
 * 「说明书」形态的前提：它写的是我们自己的实现事实，不会因为谁改了界面而过期，
 * 也不需要在这里维护第二份路径清单。
 *
 * **两个页面共用这一份实现**（引导第三步、客户端配置页）：同一个事实有两处渲染，
 * 就会有两处版式和两处「少写一条路径」的机会。所以组件本身放在共享目录里，
 * 两个页面只在外面套自己的壳（`variant`）。
 *
 * 页面上**不列任何工具的名字**：工具的产品名、菜单路径、字段叫法都由别人定义、随时会变，
 * 追着它们更新等于把维护成本建在别人的排期上。这里只回答「服务对外长什么样」，
 * 用户拿这三个事实去对任何一种客户端都成立。
 *
 * **为什么默认收起**：这一步的主线是「把三个值填进客户端」，接口面是**查错用的参考**——
 * 用户是在「连不上、想确认是不是路径写错了」的时候才需要它。四条路径 × 主写法 + 等价写法 +
 * 说明 + 协议名铺开有一屏高，默认摆出来就等于把一份速查表放进了主线的正中间：
 * 读完「要填这三个值」的人接着读这张表，会以为路径也得自己挑一条填进去。
 * 收起后这一行只说清两件事——「有几条」与「想看就点」，页脚那件真正该做的事（接上没接上）
 * 因此留在首屏。默认状态里不渲染表体：这是「默认不占视线」还是「默认只是变矮」的分界。
 */
export function InterfaceTableCard(props: InterfaceTableCardProps) {
  const { variant = 'card' } = props
  const [open, setOpen] = useState(false)
  const t = useTranslation()
  const navigate = useNavigate()

  const body = (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-1.5 px-4 py-3 text-left outline-none transition-colors',
          'system-xs-regular text-text-tertiary hover:text-text-primary',
          // 自己成卡时要与卡头分家；嵌在别人的卡里时，卡头自己已经带了那条线。
          variant === 'card' && 'border-t border-border/50',
        )}
      >
            <ChevronDown
              size={12}
              aria-hidden
              className={cn('shrink-0 transition-transform', !open && '-rotate-90')}
            />
            {open
              ? t('access.interface.collapse')
              : t('access.interface.expand', { count: PROXY_INTERFACE_ENTRIES.length })}
      </CollapsibleTrigger>

      <CollapsibleContent>
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
      </CollapsibleContent>
    </Collapsible>
  )

  /* 收尾只留一件事：怎么知道自己接上了。不放示例命令——那是「谁的写法」的问题，
     这一页不碰；请求记录里有没有这条请求是客观的，且不需要再多一个字段。
     它是**唯一常驻**的一行，因为它回答的正是「接不上怎么办」，而那才是用户回到这一步的原因。 */
  const footer = (
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
        <ArrowRight />
        {t('access.interface.openLogs')}
      </Button>
    </div>
  )

  if (variant === 'flat') return <>{body}{footer}</>

  return (
    <Card className="pb-0">
      <SettingsCardHeader
        icon={<ListTree />}
        title={t('access.interface.title')}
        description={t('access.interface.description')}
      />
      <CardContent className="p-0">
        {body}
      </CardContent>
      {footer}
    </Card>
  )
}
