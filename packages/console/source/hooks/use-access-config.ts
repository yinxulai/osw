import { isWildcardHost, resolveProxyOrigin } from '@common/proxy-origin'
import { useProxyStatus } from '@/data/proxy'
import { useProxyToggle } from '@/pages/logical-models/hooks/use-proxy-toggle'

/**
 * 「客户端怎么连上本机服务」那一组卡片的数据源：把监听 host / port 收敛成客户端能直接使用的**服务根地址**。
 *
 * 监听通配地址时它本身不是可访问地址，回落到 127.0.0.1，并把情况告诉调用方。
 * 这里只产出根地址（`http://host:port`）：各协议的 Base URL / 完整接口地址是
 * 「根地址 + 协议路径」的纯拼接，属于展示逻辑，放在卡片里算，不在这里预拼。
 *
 * 共享而不是各页自己拼：引导页与客户端配置页给的是同一组事实，
 * 两处各算一遍，迟早会算出两个地址（见 `@common/proxy-origin`）。
 */
export function useAccessConfig() {
  const proxyStatus = useProxyStatus()
  const { toggleProxy } = useProxyToggle()

  const host = proxyStatus?.host ?? ''
  const port = proxyStatus?.port ?? null

  return {
    host,
    port,
    running: proxyStatus?.running ?? false,
    wildcardHost: isWildcardHost(host),
    // 地址拼不出来时给空串：调用方（复制按钮）用空值判断要不要禁用。
    origin: resolveProxyOrigin(host, port) ?? '',
    toggleProxy,
  }
}
