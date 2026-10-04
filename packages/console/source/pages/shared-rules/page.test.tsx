// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedRewriteRule } from '@common/shared-rewrite-rules'
import type { RequestRewriteRule } from '@common/schemas'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { sharedRewriteRuleApi } from '@/api/models'
import { SharedRulesPage } from './page'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 页面外壳（页头、面包屑）依赖路由与面包屑上下文，与本次断言无关的装饰；这里降为透传，
// 保证测的是表格与数据流本身，而不是套壳。
interface PassthroughProps { children: ReactNode }
vi.mock('@/components/layout', () => ({
  PageLayout: (props: PassthroughProps) => props.children,
  PageHeader: () => null,
  PageContent: (props: PassthroughProps) => props.children,
}))

// 目录与请求重写都要打管理服务；这里只验证页面行为，把 api 层整体换成桩。
vi.mock('@/api/models', () => ({
  sharedRewriteRuleApi: { list: vi.fn(), get: vi.fn(), publish: vi.fn(), use: vi.fn() },
  requestRewriteRuleApi: { get: vi.fn() },
}))

const mockedApi = vi.mocked(sharedRewriteRuleApi)

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <ToastProvider>{props.children}</ToastProvider>
    </I18nProvider>
  )
}

function ruleOf(overrides: Partial<SharedRewriteRule> = {}): SharedRewriteRule {
  return {
    id: 'shared_1',
    name: 'Strip cache_control',
    description: 'Remove Anthropic cache hints.',
    scope: 'global',
    schemaVersion: 1,
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [],
    testCases: [],
    usageCount: 3,
    createdTime: 1_700_000_000_000,
    updatedTime: 1_700_000_000_000,
    ...overrides,
  }
}

/** 「使用」返回的是落成本机规则后的记录，带 `enabled` / `source` 等本机字段。 */
function adoptedRuleOf(overrides: Partial<RequestRewriteRule> = {}): RequestRewriteRule {
  return {
    id: 'local_1',
    name: 'Strip cache_control',
    description: 'Remove Anthropic cache hints.',
    enabled: true,
    scope: 'global',
    schemaVersion: 1,
    source: 'imported',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [],
    testCases: [],
    createdTime: 1_700_000_000_000,
    updatedTime: 1_700_000_000_000,
    deletedTime: null,
    ...overrides,
  }
}

function listResult(rules: SharedRewriteRule[]) {
  return { success: true as const, data: { rules, total: rules.length, limit: 50, offset: 0 } }
}

describe('SharedRulesPage', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    vi.clearAllMocks()
    // Radix Select 在打开时会调用 `scrollIntoView`，jsdom 没有实现它。
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('按用量列出目录规则，并把计数渲染出来', async () => {
    mockedApi.list.mockResolvedValue(listResult([ruleOf()]))
    render(<SharedRulesPage />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('Strip cache_control')).toBeTruthy())
    expect(mockedApi.list).toHaveBeenCalledWith(expect.objectContaining({ sort: 'popular' }))
    expect(screen.getByText('3×')).toBeTruthy()
  })

  it('在本地按关键词过滤已取回的规则', async () => {
    mockedApi.list.mockResolvedValue(listResult([
      ruleOf({ id: 'a', name: 'Alpha rule' }),
      ruleOf({ id: 'b', name: 'Beta rule' }),
    ]))
    render(<SharedRulesPage />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('Alpha rule')).toBeTruthy())

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'beta' } })

    expect(screen.queryByText('Alpha rule')).toBeNull()
    expect(screen.getByText('Beta rule')).toBeTruthy()
  })

  it('切换排序时回到服务端重新取数', async () => {
    mockedApi.list.mockResolvedValue(listResult([ruleOf()]))
    render(<SharedRulesPage />, { wrapper: Wrapper })

    await waitFor(() => expect(mockedApi.list).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByText('Newest'))

    await waitFor(() => expect(mockedApi.list).toHaveBeenCalledWith(expect.objectContaining({ sort: 'recent' })))
  })

  it('使用一条规则后就地更新计数并提示成功', async () => {
    mockedApi.list.mockResolvedValue(listResult([ruleOf()]))
    mockedApi.use.mockResolvedValue({ success: true, data: adoptedRuleOf() })
    render(<SharedRulesPage />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('Strip cache_control')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Use/ }))

    await waitFor(() => expect(mockedApi.use).toHaveBeenCalledWith('shared_1'))
    await waitFor(() => expect(screen.getByText('4×')).toBeTruthy())
  })
})
