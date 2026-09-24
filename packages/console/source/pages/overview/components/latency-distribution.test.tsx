// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { LatencyDistribution } from './latency-distribution'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

describe('LatencyDistribution', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'en' })
  })

  it('shows an empty state without TTFT buckets', () => {
    render(<LatencyDistribution buckets={[]} />, { wrapper: Wrapper })

    expect(screen.getByText('No TTFT data yet')).not.toBeNull()
  })

  it('renders a vertical bar chart for TTFT buckets', () => {
    const { container } = render(
      <LatencyDistribution
        buckets={[
          { range: '0-100ms', count: 1, percent: 50 },
          { range: '100-200ms', count: 1, percent: 50 },
        ]}
      />,
      { wrapper: Wrapper },
    )

    expect(screen.queryByText('No TTFT data yet')).toBeNull()
    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull()
    expect(screen.queryAllByRole('progressbar')).toEqual([])
  })
})
