import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { settingsKeys } from '@/data/settings'
import { providerKeys } from '@/data/providers'
import { logicalModelKeys } from '@/data/logical-models'
import { healthKeys } from '@/data/health'
import { proxyKeys } from '@/data/proxy'

/**
 * 重新拉取所有与运行时配置相关的查询。
 *
 * 使用 refetchQueries 而非 invalidateQueries：调用方紧接着要读到最新数据，不能读到拉取前的旧值。
 */
export function useRuntimeDataReload(): () => Promise<void> {
  const client = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      settingsKeys.all,
      providerKeys.all,
      logicalModelKeys.all,
      healthKeys.all,
      proxyKeys.status,
    ].map(queryKey => client.refetchQueries({ queryKey })))
  }, [client])
}
