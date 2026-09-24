import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ClientConfigApplyResult,
  ClientConfigFileState,
  ClientConfigFillResultItem,
  ClientConfigOverviewItem,
  ClientConfigVersionSummary,
  ClientConfigWriteResult,
} from '@common/client-config'
import { clientConfigApi } from '@/api/client-config'
import { unwrap } from '@/api/unwrap'

export const clientConfigKeys = {
  all: ['client-config'] as const,
  overview: () => ['client-config', 'overview'] as const,
  file: (clientKey: string, filePath: string) => ['client-config', 'file', clientKey, filePath] as const,
  versions: (clientKey: string, filePath: string) => ['client-config', 'versions', clientKey, filePath] as const,
}

/**
 * 一个客户端配置文件的当前状态。
 *
 * `enabled: false` 时不发请求：页面在还没选中文件（例如客户端一个文件都没声明）之前
 * 就不该拿空 key 去打接口。
 */
const useFileQuery = (clientKey: string, filePath: string, enabled: boolean) =>
  useQuery({
    queryKey: clientConfigKeys.file(clientKey, filePath),
    queryFn: () => unwrap(clientConfigApi.getFile(clientKey, filePath)),
    enabled: enabled && clientKey !== '' && filePath !== '',
  })

export function useClientConfigFile(clientKey: string, filePath: string): ClientConfigFileState | null {
  return useFileQuery(clientKey, filePath, true).data ?? null
}

export function useClientConfigFileStatus(clientKey: string, filePath: string): { loading: boolean; error: string | null } {
  const query = useFileQuery(clientKey, filePath, true)
  return { loading: query.isPending, error: query.error?.message ?? null }
}

export function useClientConfigVersions(clientKey: string, filePath: string): ClientConfigVersionSummary[] {
  const query = useQuery({
    queryKey: clientConfigKeys.versions(clientKey, filePath),
    queryFn: () => unwrap(clientConfigApi.listVersions(clientKey, filePath)),
    enabled: clientKey !== '' && filePath !== '',
  })
  return query.data ?? []
}

export function useClientConfigVersionsLoading(clientKey: string, filePath: string): boolean {
  return useQuery({
    queryKey: clientConfigKeys.versions(clientKey, filePath),
    queryFn: () => unwrap(clientConfigApi.listVersions(clientKey, filePath)),
    enabled: clientKey !== '' && filePath !== '',
  }).isPending
}

/**
 * 三个写入口（填充 / 手动保存 / 恢复）。
 *
 * 每次都同时失效「文件状态」与「版本列表」：任何一次提交都会先备份再落盘，
 * 所以两边**一定**一起变了，分开失效只会让界面出现「内容更新了但历史少一条」的瞬间。
 * 列表页的概览也一并失效——它说的正是「这个客户端的配置现在对不对」，写入之后必然变。
 */
export function useClientConfigActions(clientKey: string, filePath: string) {
  const queryClient = useQueryClient()
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: clientConfigKeys.file(clientKey, filePath) }),
      queryClient.invalidateQueries({ queryKey: clientConfigKeys.versions(clientKey, filePath) }),
      queryClient.invalidateQueries({ queryKey: clientConfigKeys.overview() }),
    ])
  }

  const apply = useMutation<ClientConfigApplyResult, Error, { baseUrl: string; apiKey: string; model: string; smallModel?: string }>({
    mutationFn: values => unwrap(clientConfigApi.apply(clientKey, filePath, values)),
    onSuccess: invalidate,
  })

  const save = useMutation<ClientConfigWriteResult, Error, { content: string; note?: string }>({
    mutationFn: ({ content, note }) => unwrap(clientConfigApi.save(clientKey, filePath, content, note)),
    onSuccess: invalidate,
  })

  const restore = useMutation<ClientConfigWriteResult, Error, { id: string }>({
    mutationFn: ({ id }) => unwrap(clientConfigApi.restoreVersion(clientKey, filePath, id)),
    onSuccess: invalidate,
  })

  return { apply, save, restore, refresh: invalidate }
}

const useOverviewQuery = () =>
  useQuery({
    queryKey: clientConfigKeys.overview(),
    queryFn: () => unwrap(clientConfigApi.listOverview()),
  })

/** 列表页一行一个客户端的状态。 */
export function useClientConfigOverview(): ClientConfigOverviewItem[] {
  return useOverviewQuery().data ?? []
}

export function useClientConfigOverviewStatus(): { loading: boolean; error: string | null } {
  const query = useOverviewQuery()
  return { loading: query.isPending, error: query.error?.message ?? null }
}

/**
 * 一键生效。
 *
 * 结果逐客户端返回，所以这里不弹「成功」，把汇报交给调用方——它才知道是点了一个还是全部。
 */
export function useClientConfigFill() {
  const queryClient = useQueryClient()
  return useMutation<ClientConfigFillResultItem[], Error, { clientKey?: string }>({
    mutationFn: ({ clientKey }) => unwrap(clientConfigApi.fill(clientKey)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientConfigKeys.all })
    },
  })
}
