import { useEffect } from 'react'
import { useStoreSelector } from '@/store/create-store'
import { providersService } from './service'
import { providersStore } from './store'
export function useProviders() { useEffect(() => providersService.subscribe(), []); return useStoreSelector(providersStore, s => s.data) }
export const useProvidersLoading = () => useStoreSelector(providersStore, s => s.loading)
export const useProvidersError = () => useStoreSelector(providersStore, s => s.error)
export const useProvidersActions = () => providersActions
const providersActions = { refresh: providersService.refresh }
