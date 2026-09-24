// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import type { UsageHeatBucket, UsageTrendPoint } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { UsageDistribution, type UsageDistributionMode } from './usage-distribution'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function heatBucket(label: string, requests: number): UsageHeatBucket {
  return { label, requests, success: requests, failed: 0, totalTokens: requests * 100 }
}

function trendPoint(label: string): UsageTrendPoint {
  return { label, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }
}

/**
 * 真实用法里模式状态由 `OverviewPage` 持有（切 range 时卡片会卸载，放在卡片里会被打回默认值），
 * 所以这里也用一个受控外壳，而不是让组件自己记。
 */
interface HarnessProps { initialMode?: UsageDistributionMode }

function Harness(props: HarnessProps) {
  const [mode, setMode] = useState<UsageDistributionMode>(props.initialMode ?? 'heatmap')

  return (
    <UsageDistribution
      mode={mode}
      onModeChange={setMode}
      heat={[heatBucket('2026-09-16 00:00', 3), heatBucket('2026-09-16 00:10', 0)]}
      heatIntervalMs={10 * 60_000}
      trend={[trendPoint('2026-09-16 00:00'), trendPoint('2026-09-16 00:30')]}
      trendIntervalMs={30 * 60_000}
    />
  )
}

/** Radix 的标签页认的是按下动作（鼠标或方向键），jsdom 里点一下不会自己激活。 */
function selectMode(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
}

describe('UsageDistribution', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'zh-CN' })
  })

  it('默认画热力图，副标题写热力图的格宽（比趋势桶细）', () => {
    const { container } = render(<Harness />, { wrapper: Wrapper })

    expect(container.querySelectorAll('[data-heat-label]')).toHaveLength(2)
    expect(screen.getByText('每 10 分钟用量')).not.toBeNull()
    expect(container.querySelector('[data-slot="chart"]')).toBeNull()
  })

  it('切到柱状图后换成柱状图，副标题跟着换成趋势桶宽', () => {
    const { container } = render(<Harness />, { wrapper: Wrapper })

    selectMode(/柱状图/)

    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-heat-label]')).toHaveLength(0)
    expect(screen.getByText('每 30 分钟用量')).not.toBeNull()
    // 热力图的图例只属于热力图，切走之后不该还留着。
    expect(screen.queryByText('少')).toBeNull()
  })

  it('能从柱状图切回热力图', () => {
    const { container } = render(<Harness initialMode="bars" />, { wrapper: Wrapper })

    selectMode(/热力图/)

    expect(container.querySelectorAll('[data-heat-label]')).toHaveLength(2)
    expect(screen.getByText('每 10 分钟用量')).not.toBeNull()
  })

  it('模式由调用方持有：外部改了就跟着换，不需要组件自己记', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(
      <UsageDistribution
        mode="heatmap"
        onModeChange={onChange}
        heat={[heatBucket('2026-09-16 00:00', 3)]}
        heatIntervalMs={10 * 60_000}
        trend={[trendPoint('2026-09-16 00:00')]}
        trendIntervalMs={30 * 60_000}
      />,
      { wrapper: Wrapper },
    )

    expect(container.querySelectorAll('[data-heat-label]')).toHaveLength(1)
    rerender(
      <UsageDistribution
        mode="bars"
        onModeChange={onChange}
        heat={[heatBucket('2026-09-16 00:00', 3)]}
        heatIntervalMs={10 * 60_000}
        trend={[trendPoint('2026-09-16 00:00')]}
        trendIntervalMs={30 * 60_000}
      />,
    )
    expect(container.querySelectorAll('[data-heat-label]')).toHaveLength(0)
    // 受控组件不该自己改状态：点一下只上报，换不换由调用方说了算。
    selectMode(/热力图/)
    expect(onChange).toHaveBeenCalledWith('heatmap')
    expect(container.querySelectorAll('[data-heat-label]')).toHaveLength(0)
  })
})
