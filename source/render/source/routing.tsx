import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import type { AnalyticsRange } from '@common/schemas'
import App from './App'
import { QueueControlPage } from './pages/queue-control/page'
import { ModelManagementPage } from './pages/model-management/page'
import { OverviewPage } from './pages/overview/page'
import { RuntimeSettingsPage } from './pages/runtime-settings/page'
import { LogsPage } from './pages/logs/page'
import { RequestLogsPage } from './pages/request-logs/page'
import { RequestRewriteRulesPage } from './pages/request-rewrite-rules/page'
import { AccessConfigPage } from './pages/access-config/page'

const rootRoute = createRootRoute({ component: App })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/queue', replace: true }) },
})

const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/queue',
  component: QueueRoute,
})

function QueueRoute() {
  const navigate = useNavigate()
  return (
    <QueueControlPage
      onNavigateToModels={() => void navigate({ to: '/providers' })}
      onNavigateToAccess={() => void navigate({ to: '/access' })}
      onNavigateToProviderAnalytics={providerId => void navigate({ to: '/overview/$providerId', params: { providerId }, search: { range: '7d' } })}
    />
  )
}

const providersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/providers',
  component: ProvidersRoute,
})

function ProvidersRoute() {
  const navigate = useNavigate()
  return <ModelManagementPage onNavigateToProviderAnalytics={providerId => void navigate({ to: '/overview/$providerId', params: { providerId }, search: { range: '7d' } })} />
}

interface OverviewSearch {
  range: AnalyticsRange
}

export const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overview',
  validateSearch: (search: Record<string, unknown>): OverviewSearch => ({
    range: search.range === 'today' || search.range === '30d' ? search.range : '7d',
  }),
  component: Outlet,
})

const overviewIndexRoute = createRoute({
  getParentRoute: () => overviewRoute,
  path: '/',
  component: OverviewIndexRoute,
})

function OverviewIndexRoute() {
  const { range } = overviewRoute.useSearch()
  const navigate = useNavigate({ from: overviewIndexRoute.fullPath })
  return (
    <OverviewPage
      range={range}
      onRangeChange={nextRange => void navigate({ search: { range: nextRange } })}
      onSelectProvider={providerId => {
        if (providerId) void navigate({ to: '/overview/$providerId', params: { providerId }, search: { range } })
      }}
    />
  )
}

const overviewProviderRoute = createRoute({
  getParentRoute: () => overviewRoute,
  path: '$providerId',
  component: OverviewProviderRoute,
})

function OverviewProviderRoute() {
  const { range } = overviewRoute.useSearch()
  const { providerId } = overviewProviderRoute.useParams()
  const navigate = useNavigate({ from: overviewProviderRoute.fullPath })
  return (
    <OverviewPage
      range={range}
      providerId={providerId}
      onRangeChange={nextRange => void navigate({ search: { range: nextRange } })}
      onSelectProvider={nextProviderId => {
        if (nextProviderId) {
          void navigate({ to: '/overview/$providerId', params: { providerId: nextProviderId }, search: { range } })
        } else {
          void navigate({ to: '/overview', search: { range } })
        }
      }}
    />
  )
}

const accessRoute = createRoute({ getParentRoute: () => rootRoute, path: '/access', component: AccessConfigPage })
const rulesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rules', component: RequestRewriteRulesPage })
const requestsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/requests', component: RequestLogsPage })
const logsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/logs', component: LogsPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsRoute })

function SettingsRoute() {
  return <RuntimeSettingsPage />
}

const overviewRouteTree = overviewRoute.addChildren([overviewIndexRoute, overviewProviderRoute])

const routeTree = rootRoute.addChildren([
  indexRoute,
  queueRoute,
  providersRoute,
  accessRoute,
  rulesRoute,
  overviewRouteTree,
  requestsRoute,
  logsRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <Navigate to="/queue" replace />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
