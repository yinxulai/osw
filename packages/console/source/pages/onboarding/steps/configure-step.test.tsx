// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
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

// 就地嵌进来的配置编辑器自带一整套数据查询（文件 / 版本 / 预览 / 逻辑模型……），
// 那些是客户端配置页的事、由它自己的测试守着。这一步的测试只关心**版面**：
// 编辑器在不在、摆在地址卡与接口表之间，所以把它压成一个能认出来的壳就够。
vi.mock('@/pages/client-config/components/client-config-editor', () => ({
  ClientConfigEditor: () => <div data-testid="client-config-editor" />,
}))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

describe('ConfigureStep', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('受理面与客户端配置页共用同一张卡，且直接铺开：不再收成一行', () => {
    render(<ConfigureStep />, { wrapper: Wrapper })

    // 表直接摆出来（会被转发的接口各占一行），不再有「展开 / 收起」这一步，也没有请求记录入口。
    const forwarded = PROXY_INTERFACE_ENTRIES.filter(entry => entry.protocol !== null)
    expect(screen.getAllByRole('listitem')).toHaveLength(forwarded.length)
    expect(screen.queryByRole('button', { name: /accepted paths|Hide the paths|Request Logs/ })).toBeNull()
  })

  it('不再重复服务状态：运行中 / 监听地址 / 兼容地址说明都不在第二步里', () => {
    render(<ConfigureStep />, { wrapper: Wrapper })

    // 「服务本身」的事（在不在跑、监听在哪、谁能连）不摆在这一步——这里只回答「往哪填」。
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByText('Listening on 127.0.0.1:5178')).toBeNull()
    expect(screen.queryByText('Only apps on this machine can connect')).toBeNull()
  })

  it('就地嵌入客户端配置编辑器，摆在地址卡与接口表之间', () => {
    render(<ConfigureStep />, { wrapper: Wrapper })

    const editor = screen.getByTestId('client-config-editor')
    const addressCard = screen.getByText(ORIGIN).closest('[data-slot="card"]')
    const interfaceCard = screen.getAllByRole('listitem')[0].closest('[data-slot="card"]')
    // 编辑器不夹在地址卡内部：它是紧随其后的独立一块，用户抄完值就能就地改配置。
    expect(addressCard?.contains(editor)).toBe(false)
    // 顺序是「怎么接」（地址 → 编辑器）在前、「接没接上」（接口表）在后。
    expect(editor.compareDocumentPosition(interfaceCard as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
