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

/**
 * 按运行时设置过滤导航项。
 *
 * 只过滤「整个模块被关掉」的那几项，其余原样返回——所以它是 `appNavigationItems` 的一层筛子，
 * 而不是另一份列表。设置还没加载出来时（`null`）按默认值显示：加载中先少一个入口再冒出来，
 * 比先给一个点进去是空页的入口更难受。
 */
export function resolveNavigationItems(apiKeyFeatureEnabled: boolean): AppNavigationItem[] {
  if (apiKeyFeatureEnabled) return appNavigationItems
  return appNavigationItems.filter(item => item.to !== routePaths.apiKeys)
}
