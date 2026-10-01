// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { PROTOCOL_DISPLAY_NAMES, PROXY_INTERFACE_ENTRIES } from '@common/protocols'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { InterfaceTableCard } from './interface-table-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

/** 表里应当出现的接口：会被转发给上游的那些（`protocol !== null`）。`/v1/models` 被有意排除。 */
const forwardedEntries = PROXY_INTERFACE_ENTRIES.filter(entry => entry.protocol !== null)

describe('InterfaceTableCard', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('路径清单直接铺开：这是一张参考卡，不摆「点一下才能看」', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    expect(screen.getAllByRole('listitem')).toHaveLength(forwardedEntries.length)
    // 不再支持收起：既不出现「展开」也不出现「收起」。
    expect(screen.queryByRole('button', { name: /accepted paths/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide the paths' })).toBeNull()
  })

  it('只列会被转发的接口、只写主写法：等价写法与本地应答的 /v1/models 都不出现', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    const text = screen.getAllByRole('listitem').map(row => row.textContent ?? '').join('\n')
    for (const entry of forwardedEntries) {
      expect(text).toContain(entry.method)
      expect(text).toContain(entry.paths[0])
      // 等价写法（不带 /v1）不铺第二列：它每次出现都必须恰好是主写法 `/v1/<path>` 里那一段。
      // 短路径是长路径的后缀，所以用出现次数相等来判「没有单独再列一遍」。
      const path = entry.paths[1]
      if (!path) continue
      const count = (haystack: string) => haystack.split(path).length - 1
      expect(count(text)).toBe(count(`${entry.paths[0]}`))
    }

    // `/v1/models` 由本地直接应答、不转发上游，不在这张表里。
    expect(text).not.toContain('/v1/models')
    expect(screen.queryByText('Answered locally')).toBeNull()
  })

  it('会被转发的接口都标出协议名', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    for (const entry of forwardedEntries) {
      const protocol = entry.protocol
      if (!protocol) continue
      expect(screen.getAllByText(PROTOCOL_DISPLAY_NAMES[protocol]).length).toBeGreaterThan(0)
    }
  })

  it('不再有「查看请求记录」的收尾行', () => {
    render(<InterfaceTableCard />, { wrapper: Wrapper })

    expect(screen.queryByRole('button', { name: 'Open Request Logs' })).toBeNull()
  })
})
