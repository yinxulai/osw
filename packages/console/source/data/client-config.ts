import { useQueries, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ClientConfigFileState,
  ClientConfigFillResultItem,
  ClientConfigOverviewItem,
  ClientConfigPreviewResult,
  ClientConfigVersionEntry,
  ClientConfigVersionSummary,
  ClientConfigWriteResult,
} from '@common/client-config'
import { clientConfigApi, type ClientConfigApplyValues } from '@/api/client-config'
import { unwrap } from '@/api/unwrap'

export const clientConfigKeys = {
  all: ['client-config'] as const,
  overview: () => ['client-config', 'overview'] as const,
  file: (clientKey: string, filePath: string) => ['client-config', 'file', clientKey, filePath] as const,
  versions: (clientKey: string, filePath: string) => ['client-config', 'versions', clientKey, filePath] as const,
  preview: (clientKey: string, filePath: string, model: string, smallModel: string) =>
    ['client-config', 'preview', clientKey, filePath, model, smallModel] as const,
}

/** 一个配置文件在界面上的当前状态；多文件客户端一次拿全。 */
export interface ClientConfigFileEntry {
  filePath: string
  /** 磁盘上那份文件现在的样子；还没读到是 `null`。 */
  state: ClientConfigFileState | null
  loading: boolean
  error: string | null
}

/**
 * 一个客户端**全部**配置文件的当前状态。
 *
 * 一次问全而不是按选中的那份逐个问：内容模块把每个文件摆成一个标签，切换标签时不该再等一次请求，
 * 而「保存全部」也要在看到所有文件之后才知道该写哪几份。空路径（客户端还没声明文件）直接不放请求。
 */
export function useClientConfigFiles(clientKey: string, filePaths: readonly string[]): ClientConfigFileEntry[] {
  const results = useQueries({
    queries: filePaths.map(filePath => ({
      queryKey: clientConfigKeys.file(clientKey, filePath),
      queryFn: () => unwrap(clientConfigApi.getFile(clientKey, filePath)),
      enabled: clientKey !== '' && filePath !== '',
    })),
  })
  return filePaths.map((filePath, index) => {
    const result = results[index]
    return {
      filePath,
      state: result?.data ?? null,
      loading: result?.isPending ?? true,
      error: result?.error?.message ?? null,
    }
  })
}

export function useClientConfigVersions(clientKey: string, filePath: string): ClientConfigVersionEntry[] {
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
 * 一份文件上的写入口：回退到某个历史版本。
 *
 * 手动保存走 `useClientConfigSaveMany`（一次写完所有改动过的文件），这里只留回退——
 * 回退永远是「这一份文件」的事，不跨文件。
 *
 * 每次提交都同时失效「文件状态」与「版本列表」：两者**一定**一起变了，
 * 分开失效只会让界面出现「内容更新了但历史少一条」的瞬间。
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

  const restore = useMutation<ClientConfigWriteResult, Error, { id: string }>({
    mutationFn: ({ id }) => unwrap(clientConfigApi.restoreVersion(clientKey, filePath, id)),
    onSuccess: invalidate,
  })

  return { restore, refresh: invalidate }
}

/** 一次「保存全部」的结果：逐文件分成功与失败，一份失败不拦下其余。 */
export interface ClientConfigSaveManyResult {
  saved: { filePath: string; backedUp: ClientConfigVersionSummary | null }[]
  failed: { filePath: string; message: string }[]
}

/**
 * 保存**多个**文件：逐个走同一条「先备份再落盘」的路径，一份失败不中断其余。
 *
 * 内容模块的「保存全部」按这份结果汇报：能写的先写下去，坏的单独点名——
 * 因为某个文件语法坏了就把另外几个用户明明改对的也一起拦下，不符合「保存」的意思。
 */
export function useClientConfigSaveMany(clientKey: string) {
  const queryClient = useQueryClient()
  return useMutation<ClientConfigSaveManyResult, Error, { files: { filePath: string; content: string }[] }>({
    mutationFn: async ({ files }) => {
      const saved: ClientConfigSaveManyResult['saved'] = []
      const failed: ClientConfigSaveManyResult['failed'] = []
      for (const file of files) {
        try {
          const result = await unwrap(clientConfigApi.save(clientKey, file.filePath, file.content))
          saved.push({ filePath: file.filePath, backedUp: result.backedUp })
        } catch (error) {
          failed.push({ filePath: file.filePath, message: error instanceof Error ? error.message : String(error) })
        }
      }
      return { saved, failed }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientConfigKeys.all })
    },
  })
}

/**
 * 「这些模型值写进去，每个文件会变成什么样」——只算不写。
 *
 * 一次把客户端声明的文件都问一遍，返回值与 `filePaths` 一一对应：内容模块每个标签下摆的就是各自的预览。
 * 值没被改动（`values` 为 null）时不发请求：那时候每个文件的内容就是原文，没什么可预览的。
 */
export function useClientConfigPreviews(clientKey: string, filePaths: readonly string[], values: ClientConfigApplyValues | null): (ClientConfigPreviewResult | null)[] {
  const model = values?.model ?? ''
  const smallModel = values?.smallModel ?? ''
  const results = useQueries({
    queries: filePaths.map(filePath => ({
      queryKey: clientConfigKeys.preview(clientKey, filePath, model, smallModel),
      queryFn: () => unwrap(clientConfigApi.preview(clientKey, filePath, { model, smallModel: smallModel || undefined })),
      enabled: values !== null && clientKey !== '' && filePath !== '',
    })),
  })
  return results.map(result => result.data ?? null)
}

/**
 * 「生成配置」：把客户端声明的每一份文件按本机服务改写一遍，只算不写。
 *
 * 与 `useClientConfigPreviews` 走的是同一次规划（同一个 `preview` 端点、同一套地址与密钥），
 * 差别只在用途：那个是「用户在改模型时，下面内容跟着变」，这个是**一次把推荐内容填进编辑区**，
 * 之后仍然要用户按保存才会落盘。所以这里不失效任何查询——它什么都没写。
 *
 * 一份文件算不出来（没有配方 / 格式不支持）就整次失败：生成到一半的配置不该被保存下去。
 */
export function useClientConfigGenerate(clientKey: string) {
  return useMutation<{ filePath: string; content: string }[], Error, { filePaths: readonly string[]; model: string }>({
    mutationFn: async ({ filePaths, model }) => {
      const generated: { filePath: string; content: string }[] = []
      for (const filePath of filePaths) {
        const preview = await unwrap(clientConfigApi.preview(clientKey, filePath, { model }))
        generated.push({ filePath, content: preview.content })
      }
      return generated
    },
  })
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
