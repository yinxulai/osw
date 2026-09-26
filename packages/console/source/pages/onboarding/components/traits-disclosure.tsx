import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RouteModeTraits } from '@/components/route-mode/route-mode-option-card'
import { ROUTE_MODE_OPTIONS } from '@/components/route-mode/route-mode-options'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

/**
 * 两个模式的差异点，默认收起。
 *
 * 这一步的主视图只该回答「现在按什么选路、要不要换一个」——上方两张卡片的名字、一句话摘要与
 * 「正在生效」角标就够回答它。那六行逐条对齐的差异是**用来比较的**，比较是一件要主动做的事，
 * 摊在首屏的后果是它先把人拦住：用户那一刻连模型都还没有，读完六行只会得出「我得先想清楚选哪套架构」，
 * 而实际上不选也有一套内建默认在跑。
 *
 * 收起不等于藏起来：这里是同一个 `RouteModeTraits`、同一份 `traitKeys`，与模式弹窗逐字一致，
 * 想比的人点开就有。两个模式**并排**摆（与弹窗同一种读法）：差异点天然成对，上下堆叠就读不出对应关系。
 *
 * 默认收起是刻意的（`defaultOpen` 不存在）：展开状态该由用户的一次点击建立，
 * 而不是由我们替他决定「这次你要比较」。
 */
export function TraitsDisclosure() {
  const [open, setOpen] = useState(false)
  const t = useTranslation()

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'inline-flex items-center gap-1 rounded-md system-xs-regular text-text-tertiary outline-none transition-colors',
          'hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        )}
      >
        <ChevronDown size={12} aria-hidden className={cn('transition-transform', !open && '-rotate-90')} />
        {open ? t('onboarding.step.routeMode.traits.collapse') : t('onboarding.step.routeMode.traits.expand')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 pt-3 sm:grid-cols-2">
          {ROUTE_MODE_OPTIONS.map(option => (
            <div key={option.value} className="space-y-1.5">
              <p className="system-xs-medium text-text-secondary">{t(option.labelKey)}</p>
              <RouteModeTraits option={option} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
