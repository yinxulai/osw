import { useQuery, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'

export const settingsKeys = { all: ['settings'] as const }
const useSettingsQuery = () => useQuery({ queryKey: settingsKeys.all, queryFn: () => unwrap(settingsApi.get()), staleTime: 30_000 })
export function useSettings() { return useSettingsQuery().data ?? null }
export function useSettingsLoading() { return useSettingsQuery().isPending }
export function useSettingsError() { return useSettingsQuery().error?.message ?? null }
export function useSettingsActions() { const client = useQueryClient(); return { refresh: () => { void client.invalidateQueries({ queryKey: settingsKeys.all }) } } }
