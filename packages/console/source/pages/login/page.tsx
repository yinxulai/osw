import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { FormField, FormHint } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import { useAuthSession, useLogin } from '@/data/auth'
import { localizeErrorCode } from '@/api/errors'
import { routePaths } from '@/routing/routes'
import { MANAGEMENT_PASSWORD_MIN_LENGTH } from '@common/auth'

/**
 * 登录页（全屏）。
 *
 * 它和引导页是同一类东西：**不属于任何模块**，没有侧边栏，页面上只回答一个问题
 * ——「你能不能进来」。所以它排在 `App.tsx` 的整屏分支里，排在导航表之外。
 *
 * ## 三个状态，同一套版面
 *
 * 这里的内容完全由 `/api/auth/session` 的三个字段决定，而它们回答的是三个不同的问题
 * （见 `@common/auth` 的 `AuthSessionSchema`）：
 *
 *   - `required: false` —— 这台服务不要求登录。路由不会把人送到这里；万一到了（比如
 *     在地址栏里手输 `/login`），直接放行进去，不显示任何表单。
 *   - `hasUsers: false` —— 还没有账号，这是首装状态。此时**不能显示登录表单**：它会变成
 *     一个永远登不进去的表单，用户只会反复试口令。要告诉他去终端跑 `osw user add`。
 *   - 其余 —— 正常登录表单。
 *
 * 三条分支**共用同一块卡片与同一个标题位置**：状态一变就整页重排，会让人以为换了页面。
 * 这就是「布局不随数据有无而变」那条规则的用法。
 */
export function LoginPage() {
  const session = useAuthSession()
  const t = useTranslation()
  const navigate = useNavigate()
  const login = useLogin()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)

  // 不要求登录就等于放行。放在 `useEffect` 里而不是渲染期：跳转是副作用，渲染期调用
  // 会在 StrictMode 下被执行两次，也会让「这一帧该画什么」变得不可预测。
  // `replace` 是必要的：后退键回到一个已经不需要的登录页毫无意义。
  const bypass = session !== null && !session.required
  useEffect(() => {
    if (bypass) void navigate({ to: routePaths.router, replace: true })
  }, [bypass, navigate])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (login.isPending || username.trim().length === 0 || password.length === 0) return
    login.mutate(
      { username: username.trim(), password, remember },
      { onSuccess: () => void navigate({ to: routePaths.router, replace: true }) },
    )
  }

  const errorMessage = login.error
    ? localizeErrorCode(login.error.errorCode, login.error.diagnosticMessage, login.error.errorParams)
    : null

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1.5">
          <p className="system-2xs-medium text-text-accent">{t('login.eyebrow')}</p>
          <h1 className="system-xl-semibold text-text-primary">{t('login.title')}</h1>
        </header>

        <div className="rounded-xl border border-module-border bg-card p-5">
          {session === null ? (
            // 还在问「要不要登录」。不画骨架屏：这个请求就在本机/本服务旁边，几十毫秒的事，
            // 一块闪一下的占位比空白更吵。
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : session.hasUsers ? (
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <FormField label={t('login.username')} htmlFor="login-username">
                <Input
                  id="login-username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                />
              </FormField>
              <FormField label={t('login.password')} htmlFor="login-password">
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
              </FormField>
              <label className="flex w-fit cursor-pointer items-center gap-2 system-xs-regular text-text-secondary">
                <Checkbox checked={remember} onCheckedChange={value => setRemember(value === true)} />
                {t('login.remember')}
              </label>
              {errorMessage && <FormHint tone="destructive">{errorMessage}</FormHint>}
              <Button type="submit" disabled={login.isPending || username.trim().length === 0 || password.length === 0}>
                {login.isPending ? t('login.submitting') : t('login.submit')}
              </Button>
              <FormHint>{t('login.rememberHint')}</FormHint>
            </form>
          ) : (
            // 首装：还没设防。这里要说的是「怎么建第一个账号」，而不是「口令错了」。
            <div className="space-y-3">
              <p className="system-sm-regular text-text-secondary">{t('login.noAccount')}</p>
              <p className="system-sm-regular text-text-secondary">{t('login.noAccountDetail', { minimum: MANAGEMENT_PASSWORD_MIN_LENGTH })}</p>
              <FormHint>{t('login.noAccountHint')}</FormHint>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
