// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { PROTOCOL_DISPLAY_NAMES, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { routePaths } from '@/routing/routes'
import { InterfaceTableCard } from './interface-table-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 只替换 `useNavigate`：整体 mock 会把 `createHashHistory`、`Navigate` 等真实导出一起抹掉，
// 而 `I18nProvider` 这条链上确实要用到它们。
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async importOriginal => ({ ...(await importOriginal<object>()), useNavigate: () => navigate }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const en = createAppTranslator('en')

describe('InterfaceTableCard', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    navigate.mockClear()
  })

  it('接口面默认收成一行：只报条数，不占首屏', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    expect(screen.getByRole('button', { name: `Show the ${PROXY_INTERFACE_ENTRIES.length} accepted paths` })).not.toBeNull()
    // 默认收起是「不摆出来」而不是「摆出来但变矮」：这一步的主线是把三个值填进客户端，
    // 一整屏路径速查表摆在主线中间，读起来像是路径也得自己挑一条。
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    // 收尾那件真正该做的事不跟着一起收：它就是「接不上怎么办」的答案。
    expect(screen.getByRole('button', { name: 'Open Request Logs' })).not.toBeNull()
  })

  it('展开后契约里每条接口都占一行，主写法与等价写法都写出来', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: `Show the ${PROXY_INTERFACE_ENTRIES.length} accepted paths` }))

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(PROXY_INTERFACE_ENTRIES.length)

    const text = rows.map(row => row.textContent ?? '').join('\n')
    for (const entry of PROXY_INTERFACE_ENTRIES) {
      expect(text).toContain(entry.method)
      for (const path of entry.paths) expect(text).toContain(path)
    }

    // 展开态换成「收起」，否则这颗按钮读起来像是还能再展开一次。
    expect(screen.getByRole('button', { name: 'Hide the paths' })).not.toBeNull()
  })

  it('有协议的接口标出协议名，只在本地应答的那条标成本地应答', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: `Show the ${PROXY_INTERFACE_ENTRIES.length} accepted paths` }))

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

  it('variant="flat" 只出折叠区与收尾行，外壳留给调用方', () => {
    render(<InterfaceTableCard variant="flat" />, { wrapper: Wrapper })

    // 嵌进别人的卡里时再来一层卡边框就是双重嵌套：这一档不自己出卡头与卡片。
    expect(screen.queryByText(en('access.interface.title'))).toBeNull()
    expect(document.querySelector('[data-slot="card"]')).toBeNull()
    // 折叠区与收尾行照旧：内容不跟着外壳变。
    expect(
      screen.getByRole('button', { name: en('access.interface.expand', { count: PROXY_INTERFACE_ENTRIES.length }) }),
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: en('access.interface.openLogs') })).not.toBeNull()
  })
})
