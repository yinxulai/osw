import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  notFound,
  Outlet,
  redirect,
  retainSearchParams,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { normalizeLocale } from '@common/i18n'
import type { AnalyticsRange } from '@common/schemas'
import App from '@/App'
import { ErrorFallback } from '@/components/error-boundary'
import { routePaths, SHELL_PREFIX, shellChildPath } from './routes'
import { getHistory } from './history'
import { useTranslation } from '@/i18n/provider'
import { OnboardingPage } from '@/pages/onboarding/page'
import { useAppUiStore } from '@/store/app-ui-store'
import { LogicalModelsPage } from '@/pages/logical-models/page'
import { ModelManagementPage } from '@/pages/model-management/page'
import { OverviewPage } from '@/pages/overview/page'
import { RuntimeSettingsPage } from '@/pages/runtime-settings/page'
import { LogsPage } from '@/pages/logs/page'
import { RequestLogsPage } from '@/pages/request-logs/page'
import { RequestRewriteRulesPage } from '@/pages/request-rewrite-rules/page'
import { ClientConfigPage } from '@/pages/client-config/page'
import { ClientConfigDetailPage } from '@/pages/client-config/detail'
import { RouterPage } from '@/pages/router/page'

/**
 * 根路由的报错兜底。
 *
 * 不配这个的话，TanStack Router 会在控制台警告「consider setting an 'errorComponent' in your RootRoute」，
 * 并且只给一块没有样式、没有重试按钮、且提示语不区分场景的默认界面；
 * 配了之后，任何一个路由组件在渲染期抛错都由它接管，用户能原地重试。
 */
function RootErrorComponent(props: ErrorComponentProps) {
  const t = useTranslation()
  return <ErrorFallback error={props.error} reset={props.reset} title={t('common.error.rootTitle')} description={t('common.error.rootDescription')} />
}

const rootRoute = createRootRoute({ component: App, errorComponent: RootErrorComponent })

interface ShellSearch {
  theme?: 'light' | 'dark'
}

/**
 * 应用外壳：语言段 + 跨页保留的主题参数。
 *
 * 语言为什么放在**路径段**而不是搜索参数：这是需求本身 —— 要像传统 i18n 那样改 URL 就能换语言，
 * 并且是「临时视角」而非偏好。放在路径里还顺带拿到两个好处：链接可以整条分享，
 * 静态托管做语言分流时也有东西可依据。
 *
 * `{-$lang}` 是可选段：`/router` 与 `/zh-CN/router` 命中同一条路由，只有 `params.lang` 有无之分。
 * 可选段本身**不校验语言合法性** —— 匹配到的任何字符串都会落进 `params.lang`，`/fr/router` 也会匹配成功。
 * 所以这里补一道 `beforeLoad`：认不出的语言段直接 `notFound`，交给 `defaultNotFoundComponent` 拉回 `/router`。
 * 这一道闸门同时解决两个问题：不会渲染出「语言不认识但页面照开」的怪状态，
 * 也不会让旧地址（`/providers` 这种）因为「碰巧长得像语言段」而被外壳吸收成空白页。
 *
 * 用 `normalizeLocale` 而不是严格白名单：`/zh`、`/zh-TW`、`/zh-Hans-CN` 都归到 `zh-CN`
 * （与 `parseOverrides` 同一套判断），只有真正认不出的语种才被拦下。
 *
 * 另外还有一条实测得出的路由语义，务必注意：**未知路径会一路回溯到最近能匹配的祖先**。
 * `/providers`、`/foo/bar` 这类地址会匹配成「外壳（或外壳索引）」，而不是落进 404 ——
 * 所以上面那道 `beforeLoad` 也是「外壳不再吸收任意垃圾路径」的挡板。
 */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SHELL_PREFIX,
  beforeLoad: ({ params }) => {
    if (params.lang !== undefined && !normalizeLocale(params.lang)) throw notFound()
  },
  validateSearch: (search: Record<string, unknown>): ShellSearch => ({
    theme: search.theme === 'light' || search.theme === 'dark' ? search.theme : undefined,
  }),
  // 主题是「整屏视角」，跨页跳转必须留住：否则点一下侧边栏就掉回偏好里的主题。
  // 中间件挂在父路由上会向下继承，所以各子路由自己的 `validateSearch`（range、q）照常工作，
  // 只是它们收到的 search 里会额外带上被保留下来的 theme。
  search: { middlewares: [retainSearchParams(['theme'])] },
  component: Outlet,
})

/**
 * 外壳的索引：应用默认落点。
 *
 * 没走过引导先去引导，走过了直接进智能路由。标记读的是持久化 store 的当前快照
 * （localStorage 同步回填），所以首屏不会先闪一下再跳。
 * 这里用完整的 `routePaths` 作 `to`（含 `{-$lang}` 模板），语言段会顺着继承过来 ——
 * 于是 `/zh-CN` 会落到 `/zh-CN/router`，而不是把语言甩掉。
 */
const shellIndexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  beforeLoad: () => {
    const { onboardingComplete } = useAppUiStore.getState()
    throw redirect({ to: onboardingComplete ? routePaths.router : routePaths.onboarding, replace: true })
  },
})

// 引导页由 `App.tsx` 渲染成整屏覆盖层（无侧边栏），但结构上仍是外壳的子路由，
// 这样 `/zh-CN/onboarding` 这类地址也能一并工作。
const onboardingRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.onboarding), component: OnboardingPage })

const logicalModelsRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.logicalModels), component: LogicalModelsPage })
const modelManagementRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.modelManagement), component: ModelManagementPage })
const requestRewriteRulesRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.requestRewriteRules), component: RequestRewriteRulesPage })
const routerRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.router), component: RouterPage })
const requestLogsRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.requestLogs), component: RequestLogsPage })
const runtimeSettingsRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.runtimeSettings), component: RuntimeSettingsPage })

interface OverviewSearch {
  range: AnalyticsRange
}

// `range` 定义在父路由上，索引页与供应商详情页共用同一套 search schema（页面自己读取）。
const overviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: shellChildPath(routePaths.overview),
  validateSearch: (search: Record<string, unknown>): OverviewSearch => ({
    range: search.range === 'today' || search.range === '30d' ? search.range : '7d',
  }),
  component: Outlet,
})

const overviewIndexRoute = createRoute({ getParentRoute: () => overviewRoute, path: '/', component: OverviewPage })
const overviewProviderRoute = createRoute({ getParentRoute: () => overviewRoute, path: '$providerId', component: OverviewPage })

const clientConfigRoute = createRoute({ getParentRoute: () => shellRoute, path: shellChildPath(routePaths.clientConfig), component: Outlet })

const clientConfigIndexRoute = createRoute({ getParentRoute: () => clientConfigRoute, path: '/', component: ClientConfigPage })
const clientConfigDetailRoute = createRoute({ getParentRoute: () => clientConfigRoute, path: '$clientKey', component: ClientConfigDetailPage })

interface LogsSearch {
  q?: string
}

const logsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: shellChildPath(routePaths.logs),
  validateSearch: (search: Record<string, unknown>): LogsSearch => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
  }),
  component: LogsPage,
})

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    shellIndexRoute,
    onboardingRoute,
    logicalModelsRoute,
    modelManagementRoute,
    clientConfigRoute.addChildren([clientConfigIndexRoute, clientConfigDetailRoute]),
    requestRewriteRulesRoute,
    routerRoute,
    overviewRoute.addChildren([overviewIndexRoute, overviewProviderRoute]),
    requestLogsRoute,
    logsRoute,
    runtimeSettingsRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  history: getHistory(),
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <Navigate to={routePaths.router} replace />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
