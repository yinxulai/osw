import { useNavigate } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'
import { AddressCard } from '@/pages/access-config/components/address-card'
import { InterfaceTableCard } from '@/pages/access-config/components/interface-table-card'
import { ServiceStatusBar } from '@/pages/access-config/components/service-status-bar'
import { useAccessConfig } from '@/pages/access-config/hooks/use-access-config'
import { useCopyToClipboard } from '@/pages/access-config/hooks/use-copy-to-clipboard'

/**
 * 第三步：配置到工具。
 *
 * 三块内容和接入配置页完全一致（服务状态 → 要填的三个值 → 受理的路径），
 * 因为它们回答的是同一组问题：服务在不在跑、客户端该填什么、哪些路径会被受理。
 * 引导页不另写一套「简化版」，免得两处说法漂移 —— 用户照着引导填完，
 * 回到接入配置页看到的是同一份事实。
 *
 * 收尾的「打开接入配置」是给「想现在就细看」的人的出口；引导至此已经讲完了三件事。
 */
export function ConfigureStep() {
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()
  const navigate = useNavigate()
  const t = useTranslation()

  return (
    <div className="space-y-4">
      <ServiceStatusBar
        running={config.running}
        host={config.host}
        port={config.port}
        wildcardHost={config.wildcardHost}
      />
      <AddressCard origin={config.origin} copiedKey={copiedKey} onCopy={copy} />
      <InterfaceTableCard />
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => void navigate({ to: routePaths.accessConfig })}
      >
        <ExternalLink />
        {t('onboarding.configure.openAccess')}
      </Button>
    </div>
  )
}
