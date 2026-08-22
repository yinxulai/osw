import { useEffect } from 'react'
import { useStoreSelector } from '@/store/create-store'
import { healthService } from './service'
import { healthStore } from './store'
export function useHealth() { useEffect(() => healthService.subscribe(), []); return useStoreSelector(healthStore, s => s) }
export const useHealthLoading = () => useStoreSelector(healthStore, s => s.loading)
export const useHealthError = () => useStoreSelector(healthStore, s => s.error)
export const useHealthActions = () => healthActions
const healthActions = { refresh: healthService.refresh }
