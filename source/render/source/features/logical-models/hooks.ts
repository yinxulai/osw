import { useEffect } from 'react'
import { useStoreSelector } from '@/store/create-store'
import { logicalModelsService } from './service'
import { logicalModelsStore } from './store'
export function useLogicalModels() { useEffect(() => logicalModelsService.subscribe(), []); return useStoreSelector(logicalModelsStore, s => s.data) }
export const useLogicalModelsLoading = () => useStoreSelector(logicalModelsStore, s => s.loading)
export const useLogicalModelsError = () => useStoreSelector(logicalModelsStore, s => s.error)
export const useLogicalModelsActions = () => logicalModelsActions
const logicalModelsActions = { refresh: logicalModelsService.refresh }
