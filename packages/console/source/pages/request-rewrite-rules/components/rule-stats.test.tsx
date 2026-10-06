// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RuleStats } from './rule-stats'
import type { RequestRewriteRule } from '../types'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function rule(overrides: Partial<RequestRewriteRule> = {}): RequestRewriteRule {
  return {
    id: 'rule-1',
    name: '规则',
    description: '',
    enabled: true,
    global: false,
    source: 'user',
    protocols: [],
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [],
    testCases: [],
    boundProviders: 0,
    updatedTime: null,
    ...overrides,
  }
}

/** 指标格的标签行是 `mb-1` 那一层；图标 `aria-hidden`，取到的就是标签文字。 */
function labels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.mb-1')].map(node => (node.textContent ?? '').trim())
}

/** 正文是第二行（`system-xl-semibold`）。 */
function values(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.system-xl-semibold')].map(node => (node.textContent ?? '').trim())
}

beforeEach(() => {
  // 固定语言，避免测试结果依赖运行环境的系统语言。
  useLanguageStore.setState({ preference: 'zh-CN' })
})

describe('RuleStats', () => {
  it('四格依次是全部规则、全局规则、普通规则、已启用', () => {
    const { container } = render(<RuleStats rules={[rule()]} />, { wrapper })

    expect(labels(container)).toEqual(['全部规则', '全局规则', '普通规则', '已启用'])
  })

  it('每格数的是各自的口径：总数 / global / 非 global / enabled', () => {
    const { container } = render(<RuleStats rules={[
      rule({ id: 'a', global: true, enabled: true }),
      rule({ id: 'b', global: false, enabled: true }),
      rule({ id: 'c', global: false, enabled: false }),
    ]} />, { wrapper })

    // 3 条：1 条全局、2 条普通、2 条启用。
    expect(values(container)).toEqual(['3', '1', '2', '2'])
  })

  it('一条规则都没有时四格都是 0，仍然渲染满 4 张卡', () => {
    const { container } = render(<RuleStats rules={[]} />, { wrapper })

    expect(labels(container)).toHaveLength(4)
    expect(values(container)).toEqual(['0', '0', '0', '0'])
  })

  it('全局与启用是两个正交的口径，不互相折叠', () => {
    const { container } = render(<RuleStats rules={[
      // 全局且停用：计入「全局规则」，不计入「已启用」。
      rule({ id: 'a', global: true, enabled: false }),
    ]} />, { wrapper })

    expect(values(container)).toEqual(['1', '1', '0', '0'])
  })
})
