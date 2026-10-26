/**
 * 登录状态的读取与登录/登出的动作。
 *
 * 与其它 `data/*` 模块的差别只有一处：**路由守卫要用它**。`beforeLoad` 不在 React 树里，
 * 拿不到 `QueryClient`，所以这里除了 react-query 的 hook 之外还提供一个模块级的
 * `loadAuthSession()`——同一个 Promise 被复用，于是「守卫问一次、组件再问一次」不会
 * 变成两次请求。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthSession } from '@common/auth'
import { authApi } from '@/api/auth'
import { ApiRequestError } from '@/api/errors'
import { unwrap } from '@/api/unwrap'

export const authKeys = { session: ['auth-session'] as const }

/**
 * 守卫用的一次性读取：`null` 表示「问不出来」（网络错误、服务没起来）。
 *
 * 问不出来时**不拦人**：此时跳到登录页只会让用户在两个都连不上服务的页面之间打转，
 * 而真正的问题（服务不在）反而看不见。真需要登录的话，第一条业务请求会 401，那时
 * 才由 `api/client.ts` 的失效回调把人送回去——那一次的判断是有依据的。
 */
let pending: Promise<AuthSession | null> | null = null

export function loadAuthSession(): Promise<AuthSession | null> {
  pending ??= unwrap(authApi.session()).catch(() => null)
  return pending
}

/** 登录、登出之后必须丢掉缓存，否则守卫会继续拿旧结论做跳转。 */
export function resetAuthSessionCache(): void {
  pending = null
}

const useAuthSessionQuery = () =>
  useQuery({ queryKey: authKeys.session, queryFn: () => unwrap(authApi.session()), staleTime: 30_000 })

export function useAuthSession(): AuthSession | null {
  return useAuthSessionQuery().data ?? null
}

export function useAuthSessionLoading(): boolean {
  return useAuthSessionQuery().isPending
}

/**
 * 登录。
 *
 * 成功后把返回的会话直接写进缓存：`/auth/login` 回的**就是**登录后的会话，再发一次
 * `/auth/session` 只是多一个来回。
 */
export function useLogin() {
  const client = useQueryClient()
  // 错误类型写成 `ApiRequestError`（而不是默认的 `Error`）：登录页要看 `errorCode` 决定
  // 是不是「口令错了」这种该留在表单里的错，而不是把一整页换掉。
  return useMutation<AuthSession, ApiRequestError, { username: string; password: string; remember: boolean }>({
    mutationFn: input => unwrap(authApi.login(input)),
    onSuccess: session => {
      resetAuthSessionCache()
      client.setQueryData(authKeys.session, session)
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation<AuthSession, ApiRequestError, void>({
    mutationFn: () => unwrap(authApi.logout()),
    onSuccess: session => {
      resetAuthSessionCache()
      client.setQueryData(authKeys.session, session)
      // 会话换了人，别的 key 下缓存的一切都不再可信（含明文密钥的导出结果）。
      void client.invalidateQueries()
    },
  })
}
