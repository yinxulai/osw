import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { AddressCard } from '@/components/address-card'
import { InterfaceTableCard } from '@/components/interface-table-card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { useAccessConfig } from '@/hooks/use-access-config'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { ServiceStatusBar } from '@/pages/onboarding/components/service-status-bar'
import { routePaths } from '@/routing/routes'

/**
 * 第三步：配置到工具。
 *
 * 三块内容，各自只回答一个问题：服务在不在跑（状态带）、客户端该填什么（地址卡）、
 * 哪些路径会被受理（接口表）。这是**新手流程**里给全那三个值的地方。
 *
 * 「不用手抄」不单独成卡，收在地址卡的收尾行里：它与地址卡说的是**同一件事的两面**
 * （照抄 / 代抄），本来就该挨着摆、中间不插别的内容。单独摆成第二张卡时，它与地址卡平起平坐，
 * 读者先看到的是「这里有两张卡」而不是「这里有一组值」；那张卡还要自带一套卡头与说明
 * （「常见客户端不用手抄」「哪些文件改了什么」），而它真正要说的只有一句
 * 「也可以让下一页替你写」。收进收尾行后，这一屏仍然只有一个主体——要抄的那几个值。
 *
 * 收尾行的措辞因此也只留**结论**：值上面已经写了，代抄的入口就在这一行。
 * 想知道「改的是哪个文件、改完能不能回退」的人点进客户端配置页就能看到，
 * 不必在引导页先读一遍那一页的目录。
 *
 * 接口表排在最后、且默认收起：它是**受理面**，回答的是「接上没接上」而不是「怎么接」，
 * 属于收尾而不是前面任何一步的前提——一张一屏高的路径速查表摆在主线正中间，读起来像是
 * 路径也得自己挑一条。
 *
 * 地址卡在这里传 `hintStyle="icon"`：那一步的主线是把值填进去，两条「这个值为什么长这样」的
 * 长说明收进标题行的口径图标，默认视图只剩下要抄的东西。客户端配置页不传，说明照旧摊开
 * ——那一页就是来查这些的。
 */
export function ConfigureStep() {
  const t = useTranslation()
  const navigate = useNavigate()
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()

  return (
    <div className="space-y-4">
      <ServiceStatusBar
        running={config.running}
        host={config.host}
        port={config.port}
        wildcardHost={config.wildcardHost}
      />
      <AddressCard
        origin={config.origin}
        copiedKey={copiedKey}
        onCopy={copy}
        hintStyle="icon"
        footer={(
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="min-w-0 system-xs-regular text-text-tertiary">
              {t('access.agent.hint')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => void navigate({ to: routePaths.clientConfig })}
            >
              <ArrowRight />
              {t('access.agent.open')}
            </Button>
          </div>
        )}
      />
      <InterfaceTableCard />
    </div>
  )
}
