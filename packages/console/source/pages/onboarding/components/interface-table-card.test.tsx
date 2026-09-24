// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { PROTOCOL_DISPLAY_NAMES, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { routePaths } from '@/routing/routes'
import { InterfaceTableCard } from './interface-table-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

describe('InterfaceTableCard', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    navigate.mockClear()
  })

  it('契约里每条接口都占一行，主写法与等价写法都写出来', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(PROXY_INTERFACE_ENTRIES.length)

    const text = rows.map(row => row.textContent ?? '').join('\n')
    for (const entry of PROXY_INTERFACE_ENTRIES) {
      expect(text).toContain(entry.method)
      for (const path of entry.paths) expect(text).toContain(path)
    }
  })

  it('有协议的接口标出协议名，只在本地应答的那条标成本地应答', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    const localCount = PROXY_INTERFACE_ENTRIES.filter(entry => entry.protocol === null).length
    expect(screen.getAllByText('Answered locally')).toHaveLength(localCount)

    for (const entry of PROXY_INTERFACE_ENTRIES) {
      const protocol = entry.protocol
      if (!protocol) continue
      expect(screen.getAllByText(PROTOCOL_DISPLAY_NAMES[protocol]).length).toBeGreaterThan(0)
    }
  })

  it('收尾只留一件事：把手送到请求记录', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Open Request Logs' }))

    expect(navigate).toHaveBeenCalledWith({ to: routePaths.requestLogs })
  })
})
