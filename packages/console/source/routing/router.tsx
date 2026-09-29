import { createRootRoute, createRoute, createRouter, Navigate, Outlet, redirect, retainSearchParams, type ErrorComponentProps } from '@tanstack/react-router'
import type { AnalyticsRange } from '@common/schemas'
import App from '@/App'
import { ErrorFallback } from '@/components/error-boundary'
import { routePaths } from './routes'
import { getHistory } from './history'
import { navigationBreadcrumb } from './route-breadcrumbs'
import { isThemeParam, LANG_PARAM, THEME_PARAM, type ThemeParam } from './url-overrides'
import { normalizeLocale, type Locale } from '@common/i18n'
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

interface ShellSearch {
  lang?: Locale
  theme?: ThemeParam
}

/**
 * 跟着用户走的视图参数：删掉它们，任何一次跨页跳转都会把语言与主题掉回偏好值。
 *
 * 中间件挂在根路由上会向下继承，所以各子路由自己的 `validateSearch`（`range`、`q`）照常工作，
 * 只是它们收到的 `search` 里会额外带上被保留下来的这两项。
 * 类型必须是 `Array<keyof ShellSearch>`：`retainSearchParams` 不接受退化成 `string[]` 的键。
 */
const RETAINED_APPEARANCE_PARAMS: Array<keyof ShellSearch> = [LANG_PARAM, THEME_PARAM]

const rootRoute = createRootRoute({
  component: App,
  errorComponent: RootErrorComponent,
  /**
   * 语言与主题都在查询串里（`?lang=zh-CN&theme=dark`），而不是一项当路径段、一项当查询参数。
   * 这样这两件事在下游就只有一套规则：都参加同一个 `validateSearch`、都被同一条中间件留住、
   * 都不影响路径匹配。「语言放路径段」那套的代价是每个页面路径都得带上一个模板段
   * （`/{-$lang}/router`），而 `routeId` 又是从 path 反推的，于是路径表、`routeId`、
   * `getRouteApi` 的入参全都被一个可选的视图参数污染 —— 换成查询参数后路径表就是干净的路径。
   *
   * 校验只负责把两项收敛成合法值（`undefined` = 该项没写）：写错的语种与主题会被丢掉，
   * 而不是拦住整条地址 —— 于是界面退回偏好值，而不是报错或 404。
   */
  validateSearch: (search: Record<string, unknown>): ShellSearch => ({
    lang: normalizeLocale(typeof search.lang === 'string' ? search.lang : null) ?? undefined,
    theme: isThemeParam(search.theme) ? search.theme : undefined,
  }),
  search: { middlewares: [retainSearchParams(RETAINED_APPEARANCE_PARAMS)] },
})

/**
 * 默认落点：没走过引导先去引导，走过了直接进智能路由。
 * 标记读的是持久化 store 的当前快照（localStorage 同步回填），所以首屏不会先闪一下再跳。
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    const { onboardingComplete } = useAppUiStore.getState()
    throw redirect({ to: onboardingComplete ? routePaths.router : routePaths.onboarding, replace: true })
  },
})

// 引导页由 `App.tsx` 渲染成整屏覆盖层（无侧边栏），但结构上仍与其他页面同级。
const onboardingRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.onboarding, component: OnboardingPage })

const logicalModelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.logicalModels,
  component: LogicalModelsPage,
  staticData: navigationBreadcrumb(routePaths.logicalModels),
})
const modelManagementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.modelManagement,
  component: ModelManagementPage,
  staticData: navigationBreadcrumb(routePaths.modelManagement),
})
const requestRewriteRulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.requestRewriteRules,
  component: RequestRewriteRulesPage,
  staticData: navigationBreadcrumb(routePaths.requestRewriteRules),
})
const routerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.router,
  component: RouterPage,
  staticData: navigationBreadcrumb(routePaths.router),
})
const requestLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.requestLogs,
  component: RequestLogsPage,
  staticData: navigationBreadcrumb(routePaths.requestLogs),
})
const runtimeSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.runtimeSettings,
  component: RuntimeSettingsPage,
  staticData: navigationBreadcrumb(routePaths.runtimeSettings),
})

interface OverviewSearch {
  range: AnalyticsRange
}

// `range` 定义在父路由上，索引页与供应商详情页共用同一套 search schema（页面自己读取）。
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.overview,
  validateSearch: (search: Record<string, unknown>): OverviewSearch => ({
    range: search.range === 'today' || search.range === '30d' ? search.range : '7d',
  }),
  component: Outlet,
  staticData: navigationBreadcrumb(routePaths.overview),
})

const overviewIndexRoute = createRoute({ getParentRoute: () => overviewRoute, path: '/', component: OverviewPage })
const overviewProviderRoute = createRoute({ getParentRoute: () => overviewRoute, path: '$providerId', component: OverviewPage })

const clientConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.clientConfig,
  component: Outlet,
  staticData: navigationBreadcrumb(routePaths.clientConfig),
})

const clientConfigIndexRoute = createRoute({ getParentRoute: () => clientConfigRoute, path: '/', component: ClientConfigPage })
const clientConfigDetailRoute = createRoute({ getParentRoute: () => clientConfigRoute, path: '$clientKey', component: ClientConfigDetailPage })

interface LogsSearch {
  q?: string
}

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.logs,
  validateSearch: (search: Record<string, unknown>): LogsSearch => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
  }),
  component: LogsPage,
  staticData: navigationBreadcrumb(routePaths.logs),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
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
