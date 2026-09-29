import { useMemo } from 'react'
import { useMatches } from '@tanstack/react-router'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { useTranslation } from '@/i18n/provider'
import { appNavigationItems } from './navigation'
import type { AppNavPath } from './routes'

export interface RouteBreadcrumbMetadata {
  labelKey: UiCatalogKey
  to: AppNavPath
}

export interface RouteBreadcrumb {
  label: string
  to?: AppNavPath
}

interface RouteBreadcrumbStaticData {
  breadcrumb?: RouteBreadcrumbMetadata
}

/**
 * 导航页的路由元数据直接复用侧栏的层级文案。
 * 路由是层级的唯一来源，子页面不能重新定义父级叫什么。
 */
export function navigationBreadcrumb(to: AppNavPath): RouteBreadcrumbStaticData {
  const item = appNavigationItems.find(candidate => candidate.to === to)
  if (!item) throw new Error(`Missing navigation item for ${to}`)
  return { breadcrumb: { labelKey: item.labelKey, to } }
}

export function routeBreadcrumbMetadata(staticData: unknown): RouteBreadcrumbMetadata | undefined {
  if (!staticData || typeof staticData !== 'object') return undefined
  return (staticData as RouteBreadcrumbStaticData).breadcrumb
}

export function useRouteBreadcrumbs(): RouteBreadcrumb[] {
  const matches = useMatches()
  const t = useTranslation()

  return useMemo(
    () => matches.flatMap(match => {
      const metadata = routeBreadcrumbMetadata(match.staticData)
      return metadata ? [{ label: t(metadata.labelKey), to: metadata.to }] : []
    }),
    [matches, t],
  )
}
