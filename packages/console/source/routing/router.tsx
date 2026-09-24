import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import type { AnalyticsRange } from '@common/schemas'
import App from '@/App'
import { ErrorFallback } from '@/components/error-boundary'
import { routePaths } from './routes'
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
import { AccessConfigPage } from '@/pages/access-config/page'
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

// 首页是应用的默认落点：没走过引导先去引导，走过了直接进智能路由。
// 标记读的是持久化 store 的当前快照（localStorage 同步回填），所以首屏不会先闪一下再跳。
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    const { onboardingComplete } = useAppUiStore.getState()
    throw redirect({ to: onboardingComplete ? routePaths.router : routePaths.onboarding, replace: true })
  },
})

// 引导页由 `App.tsx` 渲染成整屏覆盖层（无侧边栏），所以它不挂在 `AppLayout` 那支上。
const onboardingRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.onboarding, component: OnboardingPage })

const logicalModelsRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.logicalModels, component: LogicalModelsPage })
const modelManagementRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.modelManagement, component: ModelManagementPage })
const accessConfigRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.accessConfig, component: AccessConfigPage })
const requestRewriteRulesRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.requestRewriteRules, component: RequestRewriteRulesPage })
const routerRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.router, component: RouterPage })
const requestLogsRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.requestLogs, component: RequestLogsPage })
const runtimeSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.runtimeSettings, component: RuntimeSettingsPage })

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
})

const overviewIndexRoute = createRoute({ getParentRoute: () => overviewRoute, path: '/', component: OverviewPage })
const overviewProviderRoute = createRoute({ getParentRoute: () => overviewRoute, path: '$providerId', component: OverviewPage })

const clientConfigRoute = createRoute({ getParentRoute: () => rootRoute, path: routePaths.clientConfig, component: Outlet })

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
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  logicalModelsRoute,
  modelManagementRoute,
  accessConfigRoute,
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
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <Navigate to={routePaths.router} replace />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
