import { useEffect } from 'react'
import { useStoreSelector } from '@/store/create-store'
import { proxyService } from './service'
import { proxyStore } from './store'
export function useProxy() { useEffect(() => proxyService.subscribe(), []); return useStoreSelector(proxyStore, s => s.data) }
export const useProxyStatus = useProxy
export const useProxyLoading = () => useStoreSelector(proxyStore, s => s.loading)
export const useProxyError = () => useStoreSelector(proxyStore, s => s.error)
export const useProxyActions = () => proxyActions
const proxyActions = { start: proxyService.start, stop: proxyService.stop, restart: proxyService.restart, refresh: proxyService.refresh }
