import { useCallback, useRef, useState } from 'react'
import { outboundProxyApi, type OutboundProxyTestInput, type OutboundProxyTestResult } from '@/api/runtime'

interface ProxyTestState {
  status: 'idle' | 'running' | 'success' | 'error'
  result?: OutboundProxyTestResult
  errorMessage?: string
}

export function useOutboundProxyTest() {
  const controllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<ProxyTestState>({ status: 'idle' })

  const run = useCallback(async (input: OutboundProxyTestInput) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'running' })
    const response = await outboundProxyApi.test(input, controller.signal)
    if (controller.signal.aborted) return
    if (response.success) setState({ status: 'success', result: response.data })
    else setState({ status: 'error', errorMessage: response.errorMessage })
  }, [])

  return { ...state, run }
}
