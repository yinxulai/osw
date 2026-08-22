import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { useProxyActions, useProxyStatus } from '@/features/proxy/hooks'

export function useProxyToggle() {
  const toast = useToast()
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
    toast.success(result.data.running ? '服务已启动' : '服务已停止')
  }, [proxyActions, proxyStatus, toast])

  const proxyBaseUrl = proxyStatus ? `http://${proxyStatus.host}:${proxyStatus.port}` : ''

  return { proxyStatus, proxyBaseUrl, toggleProxy }
}
