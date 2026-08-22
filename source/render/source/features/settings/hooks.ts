import { useEffect } from 'react'
import { useStoreSelector } from '@/store/create-store'
import { settingsService } from './service'
import { settingsStore } from './store'
export function useSettings() { useEffect(() => settingsService.subscribe(), []); return useStoreSelector(settingsStore, s => s.data) }
export const useSettingsLoading = () => useStoreSelector(settingsStore, s => s.loading)
export const useSettingsError = () => useStoreSelector(settingsStore, s => s.error)
export const useSettingsActions = () => settingsActions
const settingsActions = { refresh: settingsService.refresh }
