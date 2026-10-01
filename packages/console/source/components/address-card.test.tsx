// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { AddressCard } from './address-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const ORIGIN = 'http://127.0.0.1:5178'

describe('AddressCard', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'en' })
  })

  it('只摆一条地址与一句配置说明，不再堆密钥与模型名的明细', () => {
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    // 地址是全页唯一的主角，另一种写法是一句说明，不是第二条值。
    expect(screen.getAllByText(ORIGIN)).toHaveLength(1)
    // 密钥与模型名不是「唯一的正确答案」，不摆值也不摆行，只留一句说明。
    expect(screen.queryByText('API Key')).toBeNull()
    expect(screen.queryByText('Model name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy model name' })).toBeNull()
    // 复制入口只剩地址那一个。
    expect(screen.getAllByRole('button', { name: 'Copy address' })).toHaveLength(1)
  })

  it('地址读不出来时摆占位符并把复制按钮禁用，而不是收掉这一行', () => {
    render(<AddressCard origin="" copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    expect(screen.getByText('—')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Copy address' })).toHaveProperty('disabled', true)
  })

  it('复制地址时把地址与它自己的回执 key 报给调用方', () => {
    const onCopy = vi.fn()
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={onCopy} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))

    expect(onCopy.mock.calls).toEqual([['origin', ORIGIN]])
  })

  it('footer 槽位收在卡片内部：调用方补的那句话与地址同属一张卡', () => {
    render(
      <AddressCard
        origin={ORIGIN}
        copiedKey={null}
        onCopy={() => {}}
        footer={<span>Every write keeps a version</span>}
      />,
      { wrapper: Wrapper },
    )

    const card = screen.getByText(ORIGIN).closest('[data-slot="card"]')
    expect(card?.textContent).toContain('Every write keeps a version')
    // 收尾行是卡片的最后一个孩子，不另起一张卡：它说的就是这张卡里那条地址的事。
    expect(card?.lastElementChild?.getAttribute('data-slot')).toBe('card-footer')
  })

  it('不传 footer 时卡片下边缘就是最后一行，不留空档', () => {
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    const card = screen.getByText(ORIGIN).closest('[data-slot="card"]')
    expect(card?.lastElementChild?.getAttribute('data-slot')).toBe('card-content')
    expect(card?.textContent).toContain(ORIGIN)
  })
})
