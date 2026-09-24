// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { UsageTrendPoint } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TrendChart } from './trend-chart'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function point(label: string): UsageTrendPoint {
  return { label, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }
}

describe('TrendChart', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'zh-CN' })
  })

  it('把服务端给的桶宽写成粒度副标题', () => {
    render(<TrendChart trend={[point('2026-09-09 00:00'), point('2026-09-09 00:15')]} trendIntervalMs={15 * 60_000} />, { wrapper: Wrapper })

    expect(screen.getByText('每 15 分钟用量')).not.toBeNull()
  })

  // 界面比服务端新的那段时间里，`today` 拿到的还是旧版的 `HH:MM` 标签、也没有 `trendIntervalMs`。
  // 那时坐标轴的格式化曾经在 `Intl.DateTimeFormat.format(NaN)` 上抛 `RangeError: Invalid time value`，
  // 整张图连同页面一起渲染不出来（见 `@common/analytics-buckets` 的 `parseTrendBucketLabel`）。
  it('旧版形态的响应（只写时刻、不带桶宽）也能照常画出来', () => {
    const { container } = render(
      <TrendChart trend={[point('00:00'), point('00:15')]} trendIntervalMs={undefined as unknown as number} />,
      { wrapper: Wrapper },
    )

    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull()
    expect(screen.queryByText(/NaN/)).toBeNull()
    // 刻度照原样写：这一句以前会走到 `Intl.DateTimeFormat.format(NaN)` 上抛 RangeError。
    expect(screen.queryAllByText('00:00').length).toBeGreaterThan(0)
  })
})
