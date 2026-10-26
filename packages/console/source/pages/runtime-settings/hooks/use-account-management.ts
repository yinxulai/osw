/**
 * 设置页「访问控制」那张卡的数据层。
 *
 * **不走设置草稿**：这张卡里除「要求登录」那个开关之外，每一行都是**一按即写**的账号操作
 * ——建号、改口令、删号。把它们并进「改完再一起保存」的草稿里，会出现「界面显示账号已建、
 * 服务端其实还没建」这类谁都说不清的状态（`CloudSyncCard` 出自同一个理由）。
 *
 * 开关本身留在草稿里，因为它是一项设置、要和别的设置一起保存——但账号列表不是。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ManagementUser } from '@common/auth'
import { authApi } from '@/api/auth'
import { ApiRequestError } from '@/api/errors'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

const ACCOUNTS_KEY = ['management-accounts'] as const

export function useAccountManagement() {
  const t = useTranslation()
  const toast = useToast()
  const client = useQueryClient()

  // 没有账号时接口**也**要能调通（首装态就要看到空的列表与「还没有账号」的提示），
  // 所以它在网关的公开路径名单里，而这里不因「未登录」而改变请求方式。
  const query = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: () => unwrap(authApi.listAccounts()), staleTime: 0 })

  /**
   * 三个操作回的都是**操作后的完整列表**，直接写进缓存。
   *
   * 不做 `invalidateQueries` 再等一轮：写接口的应答已经是我们需要的最新事实，
   * 再问一次只会让列表闪一下。
   */
  const create = useMutation<ManagementUser, ApiRequestError, { username: string; password: string }>({
    mutationFn: input => unwrap(authApi.createAccount(input.username, input.password)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      // 会话的 `hasUsers` 可能刚刚从 false 变成 true，登录页与路由守卫都读它。
      void client.invalidateQueries({ queryKey: ['auth-session'] })
      toast.success(t('settings.auth.created'))
    },
    onError: error => toast.error(error.message),
  })

  const remove = useMutation<ManagementUser[], ApiRequestError, { id: string }>({
    mutationFn: input => unwrap(authApi.deleteAccount(input.id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      void client.invalidateQueries({ queryKey: ['auth-session'] })
      toast.success(t('settings.auth.removed'))
    },
    onError: error => toast.error(error.message),
  })

  const changePassword = useMutation<ManagementUser[], ApiRequestError, { id: string; password: string }>({
    mutationFn: input => unwrap(authApi.changePassword(input.id, input.password)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      toast.success(t('settings.auth.passwordChanged'))
    },
    onError: error => toast.error(error.message),
  })

  return {
    accounts: query.data ?? [],
    loading: query.isPending,
    create,
    remove,
    changePassword,
  }
}
