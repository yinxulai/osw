import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { BrandMark } from '@/components/brand-mark'
import { FormField, FormHint } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import { useAuthSession, useLogin } from '@/data/auth'
import { localizeErrorCode } from '@/api/errors'
import { routePaths } from '@/routing/routes'
import { MANAGEMENT_PASSWORD_MIN_LENGTH } from '@common/auth'

/**
 * 建号命令原样写在这里，不进文案表：它是一条要在终端里逐字敲的 shell 命令，
 * 中英文都一样，翻译它只会让人多认一次（同 `access-config` 里的样例值）。
 */
const CREATE_ACCOUNT_COMMAND = 'osw user add <username>'

/**
 * 登录页（全屏）。
 *
 * 它和引导页是同一类东西：**不属于任何模块**，没有侧边栏，页面上只回答一个问题
 * ——「你能不能进来」。所以它排在 `App.tsx` 的整屏分支里，排在导航表之外。
 *
 * ## 为什么分成左右两栏
 *
 * 一开始它是一张孤零零的卡片浮在空屏幕上：一行 eyebrow、一个标题、一个表单，
 * 上下都是大片留白，看着像「页面没加载完」。而这一页**没有侧边栏兜底** ——
 * 侧栏平时负责回答「这是哪个应用」，登录页没有它，品牌就没人说了。
 *
 * 所以宽屏时左边立一条品牌栏（是一块地基，不是卡片），右边才是表单；
 * 窄屏放不下两栏，品牌收成表单上方的一行小字。**品牌只有一份内容**，
 * 靠 `lg:` 断点决定哪个位置出现，不做两套各自漂亮的版面。
 *
 * 品牌栏里那道放大的闪电是这一页唯一的装饰，也是唯一「大」的东西：
 * 排版字阶最大只到 16px（`system-xl`），拿字号做视觉锚点做不到，图形可以。
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
  const [passwordVisible, setPasswordVisible] = useState(false)

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

  /**
   * 品牌锁定组合（标志 + 名字 + 一句话标签）。
   * 两处用它：宽屏落在左栏顶部，窄屏落在表单上方——写法只有这一份，字号只定义一次。
   */
  const brandLockup = (
    <div className="flex items-center gap-2.5">
      <BrandMark size={30} />
      <div className="min-w-0">
        <p className="system-sm-semibold text-text-primary">{t('app.windowTitle')}</p>
        <p className="font-mono system-2xs-medium-uppercase tracking-[1.2px] text-text-quaternary">{t('app.tagline')}</p>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-full">
      {/*
       * 品牌栏。`w-[46%]` + `max-w-130`：再宽表单就被推到视口边上了。
       * 底色取 `bg-inset`（比画布深两档）而不是 `bg-sidebar`（它跟画布同色，实测两边看不出分界，
       * 只剩一条发丝线）；右边再补一条 `border-border/50` 收边——
       * 这是一块地基，不是模块，所以不用 `border-module-border`。
       */}
      <aside className="relative hidden w-[46%] max-w-130 shrink-0 flex-col justify-between overflow-hidden border-r border-border/50 bg-inset px-10 py-9 lg:flex">
        {brandLockup}

        {/* 唯一的视觉锚点。给足留白而不是加光晕/阴影：这里只有一道图形，安放它即可。 */}
        <div className="flex flex-1 items-center justify-center py-10">
          <BrandMark size={228} />
        </div>

        <p className="font-mono system-2xs-regular text-text-quaternary">v{__APP_VERSION__}</p>
      </aside>

      {/* 表单栏。垂直居中：内容短也不贴着顶边，不随内容多少伸缩。 */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm space-y-7">
          {/* 窄屏时这里是品牌的唯一位置；宽屏由左栏负责，这一行整个不渲染。 */}
          <div className="lg:hidden">{brandLockup}</div>

          {/*
           * 标题旁边那句话按状态换内容，页头因此始终两行、高度不变。
           * 这里**不写「管理控制台」这类 kicker**：左栏的品牌锁定组合已经说过这是哪个应用，
           * 在这个没有侧栏的整屏页里，一个 11px 的分类标签既不解释任何事，又让标题读起来
           * 像仪表盘内页的页头——登录页要说的是「接下来该做什么」，不是「你在哪个模块」。
           */}
          <header className="space-y-2">
            <h1 className="system-display-semibold text-text-primary">{t('login.title')}</h1>
            <p className="system-sm-regular text-text-secondary">
              {t(session !== null && !session.hasUsers ? 'login.descriptionNoAccount' : 'login.description')}
            </p>
          </header>

          <div className="rounded-xl border border-module-border bg-card p-6">
            {session === null ? (
              // 还在问「要不要登录」。不画骨架屏：这个请求就在本机/本服务旁边，几十毫秒的事，
              // 一块闪一下的占位比空白更吵。高度是表单真身量出来的（卡片 322 − 上下 `p-6` 48 = 274，取 272），
              // 免得到手时整块往下跳。
              <div className="flex h-68 items-center justify-center">
                <Spinner />
              </div>
            ) : session.hasUsers ? (
              <form className="grid gap-5" onSubmit={handleSubmit}>
                <FormField label={t('login.username')} htmlFor="login-username">
                  <Input
                    id="login-username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                  />
                </FormField>

                {/*
                 * 口令默认遮起来，但**要给一个看得见的开关**：登录页没有别的地方能核对
                 * 自己刚敲了什么，输错一位就得从头再打一遍。
                 * `Input` 没有 `forwardRef`，所以包一层相对定位的 div 再绝对定位按钮，
                 * 输入框加 `pr-9` 让出位置。
                 */}
                <FormField label={t('login.password')} htmlFor="login-password">
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={passwordVisible ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-9"
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setPasswordVisible(visible => !visible)}
                      aria-label={t(passwordVisible ? 'login.hidePassword' : 'login.showPassword')}
                      title={t(passwordVisible ? 'login.hidePassword' : 'login.showPassword')}
                      className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-text-quaternary transition-colors outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      {passwordVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                </FormField>

                <label className="flex w-fit cursor-pointer items-center gap-2 system-xs-regular text-text-secondary">
                  <Checkbox checked={remember} onCheckedChange={value => setRemember(value === true)} />
                  {t('login.remember')}
                </label>

                {errorMessage && <FormHint tone="destructive">{errorMessage}</FormHint>}

                {/*
                 * 只在提交中禁用。之前「两个框都空着就禁用」让按钮常年半透明，
                 * 一进页面看到的就是一颗灰按钮，读起来像「登录不了」——
                 * 空字段不提交由 `handleSubmit` 里的守卫负责，不必让按钮来表达。
                 */}
                <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
                  {login.isPending ? t('login.submitting') : t('login.submit')}
                </Button>

                <FormHint>{t('login.rememberHint')}</FormHint>
              </form>
            ) : (
              // 首装：还没设防。这里要说的是「怎么建第一个账号」，而不是「口令错了」。
              // 「还没有账号」这句话在页头说过了，这里不再重复，直接从怎么做开始。
              <div className="space-y-3">
                <p className="system-sm-regular text-text-secondary">
                  {t('login.noAccountDetail', { minimum: MANAGEMENT_PASSWORD_MIN_LENGTH })}
                </p>
                {/* 命令单独落成一块：要照着敲的那串字不该埋在句子里被行宽折断。 */}
                <code className="block overflow-x-auto rounded-lg border border-module-border bg-inset px-3 py-2 font-mono system-xs-regular text-text-primary select-all">
                  {CREATE_ACCOUNT_COMMAND}
                </code>
                <FormHint>{t('login.noAccountHint')}</FormHint>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
