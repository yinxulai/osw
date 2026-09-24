import { useCallback } from 'react'
import { resolveProxyOrigin } from '@common/proxy-origin'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useProxyActions, useProxyStatus } from '@/data/proxy'

export function useProxyToggle() {
  const toast = useToast()
  const t = useTranslation()
  const proxyStatus = useProxyStatus()
  const proxyActions = useProxyActions()

  const toggleProxy = useCallback(async () => {
    const result = proxyStatus?.running
      ? await proxyActions.stop()
      : await proxyActions.start()
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    toast.success(result.data.running ? t('logicalModels.proxy.started') : t('logicalModels.proxy.stopped'))
  }, [proxyActions, proxyStatus, t, toast])

  // 监听 0.0.0.0 时这个 host 不是能给客户端用的地址，统一走 @common 的回落逻辑。
  const proxyBaseUrl = proxyStatus ? resolveProxyOrigin(proxyStatus.host, proxyStatus.port) ?? '' : ''

  return { proxyStatus, proxyBaseUrl, toggleProxy }
}
