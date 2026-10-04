import { useQuery } from '@tanstack/react-query'
import { REPOSITORY_SLUG } from '@/lib/external-links'

/** 设置页「开发者」卡片里的一枚贡献者。 */
export interface Contributor {
  login: string
  avatarUrl: string
  profileUrl: string
  contributions: number
}

/** 贡献者头像墙的数据与加载状态。 */
export interface ContributorsResult {
  contributors: Contributor[]
  isLoading: boolean
}

export const contributorKeys = { list: ['contributors', REPOSITORY_SLUG] as const }

/**
 * 贡献者头像墙的数据。
 *
 * 数据来自 GitHub 公开 REST API：它带 `Access-Control-Allow-Origin: *`，浏览器形态与 Electron
 * 形态都能直接 `fetch`。**不带 token**：这是只读的公开仓库信息，没有理由为它引入一份凭据。
 *
 * 用量上打两个补丁：不带 token 时 GitHub 限流到每小时 60 次，所以 `staleTime` 给到 1 小时——
 * 贡献者榜单不是实时数据，没有理由让用户在设置页停留时反复问；失败也不重试（限流时越试越糟）。
 *
 * **拿不到就是空数组**：头像墙只是个彩蛋，接口失败、离线、被限流都不该把设置页变成错误页。
 * 渲染层对空数组走「不显示头像墙」的退化路径；`isLoading` 让加载中与真·失败能分别措辞。
 */
export function useContributors(): ContributorsResult {
  const query = useQuery({
    queryKey: contributorKeys.list,
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<Contributor[]> => {
      const url = `https://api.github.com/repos/${REPOSITORY_SLUG}/contributors?per_page=100`
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
      if (!response.ok) throw new Error(`GitHub contributors request failed (HTTP ${response.status})`)
      const raw = (await response.json()) as unknown
      if (!Array.isArray(raw)) return []
      return raw.flatMap((item): Contributor[] => {
        if (typeof item !== 'object' || item === null) return []
        const record = item as Record<string, unknown>
        const login = typeof record.login === 'string' ? record.login : null
        const avatarUrl = typeof record.avatar_url === 'string' ? record.avatar_url : null
        if (!login || !avatarUrl) return []
        return [{
          login,
          avatarUrl,
          profileUrl: typeof record.html_url === 'string' ? record.html_url : `https://github.com/${login}`,
          contributions: typeof record.contributions === 'number' ? record.contributions : 0,
        }]
      })
    },
  })

  return { contributors: query.data ?? [], isLoading: query.isPending }
}
