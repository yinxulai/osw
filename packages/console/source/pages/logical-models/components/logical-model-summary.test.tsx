// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { LogicalModelProviderModel } from '@common/schemas'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import type { LogicalModelSummaryMetrics } from '../lib/model-metrics'
import { LogicalModelSummary } from './logical-model-summary'

/*
 * 逻辑模型详情页顶部那四格指标。
 *
 * 两条刻意保持的规则：
 *  - **口径不进正文**：解释压在标签旁的 info 图标里（悬停/聚焦才出现），正文只有标签 + 数值两行；
 *  - **没有数据不换排版**：缺指标就渲染 `—` 占位，四张卡一样高，不改成另一种写法。
 */

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <TooltipProvider>{props.children}</TooltipProvider>
    </I18nProvider>
  )
}

function model(overrides: Partial<LogicalModelProviderModel> = {}): LogicalModelProviderModel {
  return {
    id: 'pm_a',
    providerId: 'prov_primary',
    modelName: 'gpt-5',
    endpoints: [],
    priority: 1,
    enabled: true,
    modelEnabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

function metrics(overrides: Partial<LogicalModelSummaryMetrics> = {}): LogicalModelSummaryMetrics {
  return {
    completedRequestCount: 20,
    successCount: 19,
    successRate: 0.95,
    avgDurationMilliseconds: 2_500,
    avgTps: 24,
    failoverCount: 0,
    ...overrides,
  }
}

function labels(container: HTMLElement): string[] {
  // 标签行是 `mb-1`；`InfoHint` 的图标是 `aria-hidden` 的空壳，口径文案不在文档里（浮层未展开）。
  return [...container.querySelectorAll('.mb-1')].map(node => (node.textContent ?? '').trim())
}

function values(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.system-xl-semibold')].map(node => (node.textContent ?? '').trim())
}

/** `InfoHint` 的口径文本同时是它的可访问名。 */
function infos(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button[aria-label]')].map(node => node.getAttribute('aria-label') ?? '')
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
})

describe('LogicalModelSummary', () => {
  it('四格依次是请求成功率、平均响应耗时、平均 TPS、当前可用模型', () => {
    const { container } = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics()} />, { wrapper })

    expect(labels(container)).toEqual(['请求成功率', '平均响应耗时', '平均 TPS', '当前可用模型'])
  })

  it('成功率按百分比展示并保留一位小数', () => {
    const { container } = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ successRate: 0.95 })} />, { wrapper })

    expect(values(container)[0]).toBe('95.0%')
  })

  it('耗时用 `@common/metrics` 的同一套规则：不足一秒写毫秒、一秒以上写秒', () => {
    const short = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ avgDurationMilliseconds: 820 })} />, { wrapper })
    expect(values(short.container)[1]).toBe('820ms')
    short.unmount()

    const long = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ avgDurationMilliseconds: 2_500 })} />, { wrapper })
    // 2.5s 而不是 2500ms：毫秒与秒的分界点是 1000。
    expect(values(long.container)[1]).toBe('2.5s')
  })

  it('TPS 的小数位来自量级规则：10 以下留一位，10 及以上取整', () => {
    const low = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ avgTps: 3.33 })} />, { wrapper })
    expect(values(low.container)[2]).toBe('3.3')
    low.unmount()

    const high = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ avgTps: 24 })} />, { wrapper })
    expect(values(high.container)[2]).toBe('24')
  })

  it('可用模型数 = 启用数 / 总数，两个数都渲染', () => {
    const { container } = render(<LogicalModelSummary models={[
      model({ id: 'a', enabled: true }),
      model({ id: 'b', enabled: false }),
      model({ id: 'c', enabled: true }),
    ]} summaryMetrics={metrics()} />, { wrapper })

    expect(values(container)[3]).toBe('2 / 3')
  })

  it('没有指标数据时四格仍按同一套布局渲染，缺的值写 `—`，可用模型照常算', () => {
    const { container } = render(<LogicalModelSummary models={[model({ enabled: false }), model({ id: 'b' })]} />, { wrapper })

    expect(labels(container)).toEqual(['请求成功率', '平均响应耗时', '平均 TPS', '当前可用模型'])
    expect(values(container)).toEqual(['—', '—', '—', '1 / 2'])
  })

  it('成功率的口径带样本量：有数据时写「近 N 次已完成请求」，没数据时写「等待请求数据」', () => {
    const withData = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ completedRequestCount: 42 })} />, { wrapper })
    expect(infos(withData.container)[0]).toBe('近 42 次已完成请求')
    withData.unmount()

    const withoutData = render(<LogicalModelSummary models={[model()]} />, { wrapper })
    expect(infos(withoutData.container)[0]).toBe('等待请求数据')
  })

  it('故障转移那格只说有没有：发生过给次数，没发生给「当前没有故障转移」', () => {
    const failover = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ failoverCount: 3 })} />, { wrapper })
    expect(infos(failover.container)[3]).toBe('近 3 次发生故障转移')
    failover.unmount()

    const none = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics({ failoverCount: 0 })} />, { wrapper })
    expect(infos(none.container)[3]).toBe('当前没有故障转移')
  })

  it('耗时与 TPS 的口径说明是固定的，不随数据有无变化', () => {
    const { container } = render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics()} />, { wrapper })

    expect(infos(container)[1]).toBe('服务该请求那次尝试的完整耗时，含 TTFT')
    expect(infos(container)[2]).toBe('输出 Token ÷ 该次尝试的完整耗时（含 TTFT）')
  })

  it('口径说明不在正文里出现（浮层未展开时文档中没有这段话）', () => {
    render(<LogicalModelSummary models={[model()]} summaryMetrics={metrics()} />, { wrapper })

    expect(screen.queryByText('服务该请求那次尝试的完整耗时，含 TTFT')).toBeNull()
  })
})
