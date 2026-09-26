// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { routePaths } from '@/routing/routes'
import { ConfigureStep } from './configure-step'

// `vi.mock` 会被提升到文件顶部，工厂里引用的常量也得跟着提上去。
const ORIGIN = vi.hoisted(() => 'http://127.0.0.1:5178')

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 这一步的输入只有「服务在不在跑 + 地址是什么」：代理状态那条链路（启停、托盘、监听地址）
// 由 `use-access-config` 与逻辑模型页自己的测试守着，这里只给一个稳定的地址。
vi.mock('@/hooks/use-access-config', () => ({
  useAccessConfig: () => ({
    host: '127.0.0.1',
    port: 5178,
    running: true,
    wildcardHost: false,
    origin: ORIGIN,
    toggleProxy: () => {},
  }),
}))

vi.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copiedKey: null, copy: () => {} }),
}))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const en = createAppTranslator('en')

describe('ConfigureStep', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    navigate.mockClear()
  })

  it('代抄那条路并进地址卡的收尾行，不再单独占一张卡', () => {
    render(<ConfigureStep />, { wrapper: Wrapper })

    const card = screen.getByText(ORIGIN).closest('[data-slot="card"]')
    // 手抄与代抄说的是一件事的两面，必须挨着摆：收尾行在地址卡内部，中间不会插进别的卡。
    expect(card?.textContent).toContain(en('access.agent.hint'))
    expect(screen.getByRole('button', { name: en('access.agent.open') })).not.toBeNull()
    // 收尾行在卡片内部，卡片本身已经带着地址卡的卡头，不会再多出第二套卡头。
    expect(screen.getAllByText(en('access.address.title'))).toHaveLength(1)
  })

  it('收尾行的按钮送到客户端配置页', () => {
    render(<ConfigureStep />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: en('access.agent.open') }))

    expect(navigate).toHaveBeenCalledWith({ to: routePaths.clientConfig })
  })

  it('受理面默认收起：这一步首屏只剩要抄的值与一条入口', () => {
    render(<ConfigureStep />, { wrapper: Wrapper })

    expect(
      screen.getByRole('button', { name: en('access.interface.expand', { count: PROXY_INTERFACE_ENTRIES.length }) }),
    ).not.toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    // 「接上没接上」的出口与值同在首屏：它是这一步的收尾，不是被收起来的那部分。
    expect(screen.getByRole('button', { name: en('access.interface.openLogs') })).not.toBeNull()
  })
})
