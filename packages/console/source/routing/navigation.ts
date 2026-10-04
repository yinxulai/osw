import {
  ChartColumnIncreasing,
  ClipboardList,
  Cog,
  Database,
  GitBranch,
  KeyRound,
  ListOrdered,
  ScrollText,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { routePaths, type AppNavPath } from './routes'

export interface AppNavigationItem {
  to: AppNavPath
  labelKey: UiCatalogKey
  icon: LucideIcon
  sectionKey: UiCatalogKey
}

export const appNavigationItems: AppNavigationItem[] = [
  { to: routePaths.router, labelKey: 'nav.page.router', icon: GitBranch, sectionKey: 'nav.section.primary' },
  { to: routePaths.logicalModels, labelKey: 'nav.page.logicalModels', icon: ListOrdered, sectionKey: 'nav.section.primary' },
  { to: routePaths.modelManagement, labelKey: 'nav.page.providers', icon: Database, sectionKey: 'nav.section.primary' },
  { to: routePaths.overview, labelKey: 'nav.page.overview', icon: ChartColumnIncreasing, sectionKey: 'nav.section.data' },
  { to: routePaths.requestLogs, labelKey: 'nav.page.requests', icon: ClipboardList, sectionKey: 'nav.section.data' },
  { to: routePaths.requestRewriteRules, labelKey: 'nav.page.rules', icon: SlidersHorizontal, sectionKey: 'nav.section.advanced' },
  { to: routePaths.apiKeys, labelKey: 'nav.page.apiKeys', icon: KeyRound, sectionKey: 'nav.section.system' },
  { to: routePaths.clientConfig, labelKey: 'nav.page.clientConfig', icon: Wrench, sectionKey: 'nav.section.system' },
  { to: routePaths.logs, labelKey: 'nav.page.logs', icon: ScrollText, sectionKey: 'nav.section.system' },
  { to: routePaths.runtimeSettings, labelKey: 'nav.page.settings', icon: Cog, sectionKey: 'nav.section.system' },
]

export function findCurrentNavigationItem(pathname: string): AppNavigationItem | undefined {
  return appNavigationItems.find(item => pathname === item.to || pathname.startsWith(`${item.to}/`))
}
