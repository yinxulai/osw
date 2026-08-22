import type { ApiResponse, ProxyServerStatus } from '@common/schemas'
import { proxyApi } from '@/api/runtime'
import { deepEqual } from '@/infrastructure/deep-equal'
import { pollingManager } from '@/infrastructure/polling-manager'
import { proxyStore } from './store'

const update = async (silent: boolean) => {
  if (!silent) proxyStore.setState({ loading: true })
  const result = await proxyApi.status()
  if (result.success) proxyStore.setState(current => ({ data: deepEqual(current.data, result.data) ? current.data : result.data, loading: false, error: null, loaded: true }))
  else proxyStore.setState({ loading: false, error: result.errorMessage, loaded: true })
}
export const proxyService = {
  subscribe: () => pollingManager.subscribe('proxy', 5000, update),
  refresh: () => void update(true),
  start: async (): Promise<ApiResponse<ProxyServerStatus>> => command(proxyApi.start),
  stop: async (): Promise<ApiResponse<ProxyServerStatus>> => command(proxyApi.stop),
  restart: async (): Promise<ApiResponse<ProxyServerStatus>> => command(proxyApi.restart),
}
async function command(fn: () => Promise<ApiResponse<ProxyServerStatus>>) {
  const result = await fn()
  if (result.success) proxyStore.setState(current => ({ data: deepEqual(current.data, result.data) ? current.data : result.data, error: null }))
  else proxyStore.setState({ error: result.errorMessage })
  return result
}
