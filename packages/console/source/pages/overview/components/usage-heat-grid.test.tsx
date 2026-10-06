// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { UsageHeatBucket } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { HEAT_AREA_HEIGHT, UsageHeatGrid } from './usage-heat-grid'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps {
  children: ReactNode
}

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function bucket(label: string, requests: number, success = requests, totalTokens = requests * 100): UsageHeatBucket {
  return { label, requests, success, failed: requests - success, totalTokens }
}

/**
 * 桶清单在真实响应里是连续的（空桶由服务端补零），标签也各不相同。
 * 这里从 2026-09-16 00:00 起按 10 分钟递推，日期与时刻都跟着走。
 */
function series(count: number, requests: (index: number) => number): UsageHeatBucket[] {
  const start = Date.parse('2026-09-16T00:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(start + index * 10 * 60_000)
    const pad = (value: number) => String(value).padStart(2, '0')
    return bucket(
      `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`,
      requests(index),
    )
  })
}

function cells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-heat-label]')]
}

function grid(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[role="img"]')
  if (!element) throw new Error('热力图本体不存在')
  return element
}

/** tooltip 挂在 `document.body` 上（卡片是 overflow-hidden，放卡片里会被裁掉）。 */
function tooltip(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('.pointer-events-none.fixed')
}

function tooltipRows(): string[][] {
  const element = tooltip()
  if (!element) throw new Error('tooltip 没有渲染出来')
  return [...element.querySelectorAll('.flex.items-center.justify-between')].map(row =>
    [...row.querySelectorAll('span')].map(span => span.textContent ?? ''),
  )
}

describe('UsageHeatGrid', () => {
  beforeEach(() => {
    // 固定语言，避免结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'zh-CN' })
  })

  it('图表区高度是固定的 176px（与柱状图、供应商分布一致，切模式时整行不重排）', () => {
    expect(HEAT_AREA_HEIGHT).toBe(176)
  })

  it('一格一桶，且块整体是一个 role=img 的图形（无障碍读的是这一整块，不是一百多个格子）', () => {
    const { container } = render(<UsageHeatGrid buckets={series(144, () => 1)} />, { wrapper: Wrapper })

    expect(grid(container).getAttribute('aria-label')).toBe('用量分布')
    expect(cells(container)).toHaveLength(144)
    expect(cells(container)[0].dataset.heatLabel).toBe('2026-09-16 00:00')
  })

  it('没有请求的桶也照画（0 档），不做空状态', () => {
    const { container } = render(<UsageHeatGrid buckets={[bucket('2026-09-16 00:00', 0), bucket('2026-09-16 00:10', 0)]} />, { wrapper: Wrapper })

    expect(cells(container)).toHaveLength(2)
    expect(cells(container).every(cell => cell.classList.contains('bg-heat-0'))).toBe(true)
  })

  it('档位按非零桶的分位数切（分位退化时退回等分/中间档，见 @common/analytics-buckets）', () => {
    // 8 个递增的非零桶：p25=3、p50=5、p75=7 → 1..3 是 1 档、4..5 是 2 档、6..7 是 3 档、8 是 4 档。
    const { container } = render(<UsageHeatGrid buckets={series(8, index => index + 1)} />, { wrapper: Wrapper })

    expect(cells(container).map(cell => cell.className.match(/bg-heat-\d/)![0])).toEqual([
      'bg-heat-1',
      'bg-heat-1',
      'bg-heat-1',
      'bg-heat-2',
      'bg-heat-2',
      'bg-heat-3',
      'bg-heat-3',
      'bg-heat-4',
    ])
  })

  it('非零桶全都一样时统一给中间档，不涂成一片最深色', () => {
    const { container } = render(<UsageHeatGrid buckets={[bucket('2026-09-16 00:00', 7), bucket('2026-09-16 01:00', 0), bucket('2026-09-16 02:00', 7)]} />, { wrapper: Wrapper })

    expect(cells(container).map(cell => cell.className.match(/bg-heat-\d/)![0])).toEqual(['bg-heat-2', 'bg-heat-0', 'bg-heat-2'])
  })

  it('图例是「少 → 五档色块 → 多」', () => {
    const { container } = render(<UsageHeatGrid buckets={series(3, () => 1)} />, { wrapper: Wrapper })
    const legend = container.querySelector<HTMLElement>('.mt-3')

    expect(legend?.textContent).toContain('少')
    expect(legend?.textContent).toContain('多')
    expect([...(legend?.querySelectorAll('span') ?? [])].map(span => span.className.match(/bg-heat-\d/)?.[0]).filter(Boolean)).toEqual([
      'bg-heat-0',
      'bg-heat-1',
      'bg-heat-2',
      'bg-heat-3',
      'bg-heat-4',
    ])
  })

  it('列数按块形状倒推：144 桶（今日）排 5 行 29 列，格子 26px、块宽 838px', () => {
    const { container } = render(<UsageHeatGrid buckets={series(144, () => 1)} />, { wrapper: Wrapper })
    const element = grid(container)

    // 26 * 29 + 3 * 28 = 838 —— 宽是「格子 + 间距」算死的，桶少时块不会被拉满整张卡。
    expect(element.style.maxWidth).toBe('838px')
    expect(element.style.gridTemplateColumns).toBe('repeat(29, minmax(0, 1fr))')
  })

  it('桶数越多块越矮但不长高：169 桶（近 7 天）排 6 行，格子被高度约束到 21px', () => {
    const { container } = render(<UsageHeatGrid buckets={series(169, () => 1)} />, { wrapper: Wrapper })

    // floor((176 - 30 - 5 * 3) / 6) = 21；块宽 21 * 29 + 3 * 28 = 693。
    expect(grid(container).style.maxWidth).toBe('693px')
  })

  it('没有桶时也给出一列的空网格，不炸', () => {
    const { container } = render(<UsageHeatGrid buckets={[]} />, { wrapper: Wrapper })

    expect(cells(container)).toHaveLength(0)
    expect(grid(container).getAttribute('aria-label')).toBe('用量分布')
  })

  it('悬停一格弹 tooltip：请求数、成功率、Token 消耗三行', () => {
    const { container } = render(
      <UsageHeatGrid buckets={[bucket('2026-09-16 00:00', 12, 9, 12_500), bucket('2026-09-16 00:10', 0)]} />,
      { wrapper: Wrapper },
    )

    expect(tooltip()).toBeNull()
    fireEvent.mouseOver(cells(container)[0])

    expect(tooltipRows()).toEqual([
      ['请求数', '12'],
      ['成功率', '75.0%'],
      ['Token 消耗', '12.5K'],
    ])
  })

  it('日内桶的 tooltip 标题只写时刻（与柱状图同一口径）', () => {
    const { container } = render(<UsageHeatGrid buckets={series(2, () => 1)} />, { wrapper: Wrapper })

    fireEvent.mouseOver(cells(container)[0])

    expect(tooltip()?.firstElementChild?.textContent).toBe('00:00')
  })

  it('跨天的桶标题带上日期与星期', () => {
    const { container } = render(
      <UsageHeatGrid buckets={[bucket('2026-09-15 00:00', 1), bucket('2026-09-16 00:00', 2)]} />,
      { wrapper: Wrapper },
    )

    fireEvent.mouseOver(cells(container)[0])

    const title = tooltip()?.firstElementChild?.textContent ?? ''
    expect(title).toContain('9月15日')
    expect(title).toContain('00:00')
  })

  it('没有请求的桶：成功率与 Token 都写「—」，不写 0%', () => {
    const { container } = render(<UsageHeatGrid buckets={[bucket('2026-09-16 00:00', 0), bucket('2026-09-16 00:10', 5)]} />, { wrapper: Wrapper })

    fireEvent.mouseOver(cells(container)[0])

    expect(tooltipRows()).toEqual([
      ['请求数', '0'],
      ['成功率', '—'],
      ['Token 消耗', '—'],
    ])
  })

  it('tooltip 贴近视口上沿时朝下弹（rect 全零即上半屏）', () => {
    const { container } = render(<UsageHeatGrid buckets={series(2, () => 1)} />, { wrapper: Wrapper })

    fireEvent.mouseOver(cells(container)[0])
    const element = tooltip()

    expect(element?.style.top).toBe('8px')
    expect(element?.style.transform).toBe('translate(-50%, 0)')
    // 左右各留 96px，贴着窗户边也不出界。
    expect(element?.style.left).toBe('96px')
  })

  it('鼠标移出整块就把 tooltip 收掉', () => {
    const { container } = render(<UsageHeatGrid buckets={series(2, () => 1)} />, { wrapper: Wrapper })

    fireEvent.mouseOver(cells(container)[0])
    expect(tooltip()).not.toBeNull()

    // React 的 onMouseLeave 挂在原生 mouseout 上（一次性冒泡监听），所以这里派发 mouseout。
    fireEvent.mouseOut(grid(container), { relatedTarget: document.body })
    expect(tooltip()).toBeNull()
  })

  it('悬停在格子之外（网格本身的间隙）不弹 tooltip', () => {
    const { container } = render(<UsageHeatGrid buckets={series(2, () => 1)} />, { wrapper: Wrapper })

    fireEvent.mouseOver(grid(container))

    expect(tooltip()).toBeNull()
  })

  it('换一批桶后 tooltip 跟着走（同一格重复悬停不重复设状态）', () => {
    const { container, rerender } = render(<UsageHeatGrid buckets={[bucket('2026-09-16 00:00', 3)]} />, { wrapper: Wrapper })

    fireEvent.mouseOver(cells(container)[0])
    expect(tooltipRows()[0]).toEqual(['请求数', '3'])

    rerender(<UsageHeatGrid buckets={[bucket('2026-09-16 00:00', 99)]} />)
    fireEvent.mouseOut(grid(container), { relatedTarget: document.body })
    fireEvent.mouseOver(cells(container)[0])

    expect(tooltipRows()[0]).toEqual(['请求数', '99'])
    cleanup()
  })
})
