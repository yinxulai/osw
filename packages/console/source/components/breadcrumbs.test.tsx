// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { BreadcrumbTrail, PageBreadcrumbsProvider, usePageBreadcrumb, usePageBreadcrumbs } from './breadcrumbs'

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<object>()),
  useMatches: () => [
    { staticData: {} },
    { staticData: { breadcrumb: { labelKey: 'nav.page.overview', to: '/overview' } } },
    { staticData: {} },
  ],
  useNavigate: () => navigate,
}))

interface WrapperProps {
  children: ReactNode
}

interface BreadcrumbSourceProps {
  label: string
}

function Wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <PageBreadcrumbsProvider>{props.children}</PageBreadcrumbsProvider>
    </I18nProvider>
  )
}

function BreadcrumbSource(props: BreadcrumbSourceProps) {
  usePageBreadcrumb(props.label)
  return null
}

function BreadcrumbOutput() {
  return <BreadcrumbTrail items={usePageBreadcrumbs()} />
}

describe('page breadcrumbs', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    navigate.mockClear()
  })

  it('父级来自路由，页面只补充当前层级', () => {
    render(
      <>
        <BreadcrumbSource label="Provider One" />
        <BreadcrumbOutput />
      </>,
      { wrapper: Wrapper },
    )

    expect(screen.getByRole('button', { name: 'Analytics' })).not.toBeNull()
    expect(screen.getByText('Provider One')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/overview', search: true })
  })

  it('当前层级对象变化时只更新叶子节点', () => {
    const view = render(
      <>
        <BreadcrumbSource label="Provider One" />
        <BreadcrumbOutput />
      </>,
      { wrapper: Wrapper },
    )

    view.rerender(
      <>
        <BreadcrumbSource label="Provider Two" />
        <BreadcrumbOutput />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Analytics' })).not.toBeNull()
    expect(screen.getByText('Provider Two')).not.toBeNull()
    expect(screen.queryByText('Provider One')).toBeNull()
  })
})
