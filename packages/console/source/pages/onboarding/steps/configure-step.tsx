import { AddressCard } from '@/pages/onboarding/components/address-card'
import { InterfaceTableCard } from '@/pages/onboarding/components/interface-table-card'
import { ServiceStatusBar } from '@/pages/onboarding/components/service-status-bar'
import { useAccessConfig } from '@/pages/onboarding/hooks/use-access-config'
import { useCopyToClipboard } from '@/pages/onboarding/hooks/use-copy-to-clipboard'

/**
 * 第三步：配置到工具。
 *
 * 三块内容回答同一组问题：服务在不在跑、客户端该填什么、哪些路径会被受理。
 * 这是全应用**唯一**展示这几个值的地方——客户端配置页不摆地址与密钥（它们由本机服务固定给出，
 * 不需要用户填），所以「连不上时回哪里找答案」的答案就落在这一步里。
 */
export function ConfigureStep() {
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
      <AddressCard origin={config.origin} copiedKey={copiedKey} onCopy={copy} />
      <InterfaceTableCard />
    </div>
  )
}
