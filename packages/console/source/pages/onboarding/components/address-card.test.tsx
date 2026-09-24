// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { SAMPLE_API_KEY, SAMPLE_MODEL_NAME } from '../service-facts'
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

  it('只给一条地址，另两个值当作占位值摆在设置行里', () => {
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    // 地址是全页唯一的主角，另一种写法是一句说明，不是第二条值。
    expect(screen.getAllByText(ORIGIN)).toHaveLength(1)
    expect(screen.getByText(SAMPLE_API_KEY)).not.toBeNull()
    expect(screen.getByText(SAMPLE_MODEL_NAME)).not.toBeNull()
  })

  it('地址读不出来时摆占位符并把复制按钮禁用，而不是收掉这一行', () => {
    render(<AddressCard origin="" copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    expect(screen.getByText('—')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Copy address' })).toHaveProperty('disabled', true)
  })

  it('三个入口各自报出自己的回执 key，回执才能落到具体那一行', () => {
    const onCopy = vi.fn()
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={onCopy} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy API Key' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy model name' }))

    expect(onCopy.mock.calls).toEqual([
      ['origin', ORIGIN],
      ['apiKey', SAMPLE_API_KEY],
      ['modelName', SAMPLE_MODEL_NAME],
    ])
  })
})
