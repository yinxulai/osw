import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CloudSyncConfigureRequest } from '@common/cloud-sync'
import { cloudSyncApi } from '@/api/cloud-sync'
import { unwrap } from '@/api/unwrap'

export const cloudSyncKeys = { status: ['cloud-sync', 'status'] as const }

const useCloudSyncStatusQuery = () => useQuery({
  queryKey: cloudSyncKeys.status,
  queryFn: () => unwrap(cloudSyncApi.status()),
  // 状态里只有「上次同步时间」会随时间变，而这需要用户自己动手才会变，因此没必要轮询。
  staleTime: 30_000,
})

export function useCloudSyncStatus() { return useCloudSyncStatusQuery().data ?? null }
export function useCloudSyncLoading() { return useCloudSyncStatusQuery().isPending }

/**
 * 同步动作的写入口。
 *
 * 每个动作成功后都强制刷新状态：`push` 可能顺手新建了 Gist、`pull` 会改「上次拉取时间」，
 * 这些都由服务端写回，界面不能靠本地推算。同时失效设置缓存——令牌与 Gist 都是设置项，
 * 别处读到的 `settings` 对象不该是旧的。
 */
export function useCloudSyncActions() {
  const client = useQueryClient()
  const refresh = (extra: unknown) => {
    client.setQueryData(cloudSyncKeys.status, extra)
    void client.invalidateQueries({ queryKey: cloudSyncKeys.status })
    void client.invalidateQueries({ queryKey: ['settings'] })
  }

  const configure = useMutation({
    mutationFn: (input: CloudSyncConfigureRequest) => unwrap(cloudSyncApi.configure(input)),
    onSuccess: status => refresh(status),
  })
  const test = useMutation({
    mutationFn: () => unwrap(cloudSyncApi.test()),
    onSuccess: status => refresh(status),
  })
  const push = useMutation({
    mutationFn: () => unwrap(cloudSyncApi.push()),
    onSuccess: result => refresh(result.status),
  })
  const pull = useMutation({
    mutationFn: () => unwrap(cloudSyncApi.pull()),
    onSuccess: result => refresh(result.status),
  })

  return { configure, test, push, pull }
}
