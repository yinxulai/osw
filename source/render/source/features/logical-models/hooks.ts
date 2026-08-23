import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'

export const logicalModelKeys = { all: ['logical-models'] as const }
const useLogicalModelsQuery = () => useQuery({ queryKey: logicalModelKeys.all, queryFn: () => unwrap(logicalModelApi.list()), refetchInterval: 30_000 })
export function useLogicalModels() { return useLogicalModelsQuery().data ?? [] }
export function useLogicalModelsLoading() { return useLogicalModelsQuery().isPending }
export function useLogicalModelsError() { return useLogicalModelsQuery().error?.message ?? null }
export function useLogicalModelsActions() { const client = useQueryClient(); return { refresh: () => { void client.invalidateQueries({ queryKey: logicalModelKeys.all }) } } }
