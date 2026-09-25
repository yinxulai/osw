import { AddressCard } from '@/components/address-card'
import { useAccessConfig } from '@/hooks/use-access-config'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { InterfaceTableCard } from '@/pages/onboarding/components/interface-table-card'
import { ServiceStatusBar } from '@/pages/onboarding/components/service-status-bar'

/**
 * 第三步：配置到工具。
 *
 * 三块内容回答同一组问题：服务在不在跑、客户端该填什么、哪些路径会被受理。
 * 这是**新手流程**里给全这三个值的地方——清单里已有的客户端由客户端配置页自动写，
 * 清单以外的工具则在那一页顶部拿到同一组事实（同一个数据源、同一份接口清单），
 * 所以「连不上时回哪里找答案」有两条路可走，值本身只有一份。
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
