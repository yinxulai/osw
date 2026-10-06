// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformCapabilities } from '@/platform/capabilities'
import { AppLayout, PageContent, PageHeader, PageLayout } from './layout'

/*
 * 页面骨架的四个壳：应用外壳、页面容器、页头、内容区。
 *
 * 这里唯一有「条件」的地方是页头：浏览器形态下才画面包屑（Electron 有原生标题栏，
 * 再画一条就是重复导航）。其余全是排版，断言只看「该出现的内容都在、条件不该出现时确实没有」，
 * 不去钉具体的类名组合。
 */

const platforms = { capabilities: null as unknown as PlatformCapabilities }

vi.mock('@/platform/capabilities', () => ({ getPlatformCapabilities: () => platforms.capabilities }))

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface BreadcrumbTrailProps { items: { label: string }[] }

// 页头读的是「当前层级」列表，直接给一条父级路径即可。
vi.mock('@/components/breadcrumbs', async () => {
  return {
    BreadcrumbTrail: ({ items }: BreadcrumbTrailProps) => (
      <nav aria-label="面包屑">{items.map(item => <span key={item.label}>{item.label}</span>)}</nav>
    ),
    // 只有一条时页头不画面包屑（长度 > 1 才画），这里给两条父级。
    usePageBreadcrumbs: () => [{ label: '概览' }, { label: '总览' }],
    usePageBreadcrumb: () => {},
  }
})

function setPlatform(name: 'electron' | 'web') {
  platforms.capabilities = { name } as PlatformCapabilities
}

beforeEach(() => {
  setPlatform('web')
})

describe('应用外壳', () => {
  it('画侧栏与正文两块，侧栏状态决定列宽', () => {
    const { container, rerender } = render(
      <AppLayout sidebar={<span>侧栏内容</span>}><span>正文</span></AppLayout>,
    )

    expect(screen.getByText('侧栏内容')).toBeTruthy()
    expect(screen.getByText('正文')).toBeTruthy()
    expect(container.querySelector('aside')).toBeTruthy()
    expect(container.querySelector('main')).toBeTruthy()

    expect(container.firstElementChild?.className).toContain('grid-cols-[3rem_minmax(0,1fr)]')
    rerender(<AppLayout sidebar={<span>侧栏内容</span>} sidebarExpanded><span>正文</span></AppLayout>)
    expect(container.firstElementChild?.className).toContain('grid-cols-[14rem_minmax(0,1fr)]')
  })
})

describe('页面容器', () => {
  it('只负责纵向间距，额外类名会并进去', () => {
    const { container } = render(<PageLayout className="pb-4"><span>内容</span></PageLayout>)

    expect(container.firstElementChild?.className).toContain('pb-4')
    expect(screen.getByText('内容')).toBeTruthy()
  })
})

describe('页头', () => {
  it('标题、说明、右侧动作各就各位', () => {
    render(
      <PageHeader
        title="请求记录"
        description="最近的代理请求"
        actions={<button type="button">试运行</button>}
      />,
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('请求记录')
    expect(screen.getByText('最近的代理请求')).toBeTruthy()
    expect(screen.getByRole('button', { name: '试运行' })).toBeTruthy()
  })

  it('标题后面的附属控件跟标题并排，而不是跑到右侧动作区', () => {
    render(<PageHeader title="路由" titleAdornment={<span>规则模式</span>} />)

    const heading = screen.getByRole('heading', { level: 1 })
    const adornment = screen.getByText('规则模式')
    expect(heading.parentElement?.contains(adornment)).toBe(true)
  })

  it('没给说明就不画那一行（不留空段落）', () => {
    const { container } = render(<PageHeader title="运行日志" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('浏览器形态下画面包屑，Electron 不画（原生标题栏已经有了）', () => {
    const { unmount } = render(<PageHeader title="概览" />)
    expect(screen.getByLabelText('面包屑')).toBeTruthy()
    expect(screen.getByText('总览')).toBeTruthy()
    unmount()

    setPlatform('electron')
    render(<PageHeader title="概览" />)
    expect(screen.queryByLabelText('面包屑')).toBeNull()
  })
})

describe('页面内容区', () => {
  it('透出截图锚点（截取局部画面时靠它定位）', () => {
    const { container } = render(
      <PageContent dataScreenshot="logs-toolbar"><span>内容</span></PageContent>,
    )

    expect(container.querySelector('[data-screenshot="logs-toolbar"]')).toBeTruthy()
  })

  it('不给锚点就不写这个属性', () => {
    const { container } = render(<PageContent><span>内容</span></PageContent>)
    expect(container.querySelector('[data-screenshot]')).toBeNull()
  })
})
