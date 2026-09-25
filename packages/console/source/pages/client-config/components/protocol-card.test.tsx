// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ProtocolCard } from './protocol-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

describe('ProtocolCard', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'en' })
  })

  it('契约里每条接口都占一行，方法、主写法与等价写法都写出来', () => {
    render(<ProtocolCard />, { wrapper: Wrapper })

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(PROXY_INTERFACE_ENTRIES.length)

    const text = rows.map(row => row.textContent ?? '').join('\n')
    for (const entry of PROXY_INTERFACE_ENTRIES) {
      expect(text).toContain(entry.method)
      for (const path of entry.paths) expect(text).toContain(path)
    }
  })

  it('协议名摆的是正式叫法，本地应答的接口用中文说明兜底', () => {
    render(<ProtocolCard />, { wrapper: Wrapper })

    // 用户要拿这一列去对照自己客户端里的「协议 / API 类型」，写意译名就对不上了。
    expect(screen.getByText('Anthropic Messages')).not.toBeNull()
    expect(screen.getByText('OpenAI Completions')).not.toBeNull()
    // `/v1/models` 不转发上游，没有协议名可写。
    expect(screen.getByText(/Model list/)).not.toBeNull()
  })
})
