// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { StatsSummary } from '@common/schemas'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { StatsGrid } from './stats-grid'

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

function summary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    totalRequests: 1234,
    successCount: 1230,
    failedCount: 4,
    successRate: 0.9876,
    inputTokens: 1_000,
    outputTokens: 500,
    totalTokens: 1_500,
    cacheHitRate: 0.5,
    ...overrides,
  }
}

/**
 * 指标格的正文是第二行（第一行是标签行）。用它取数，不吃 `NumberTicker` 逐帧动画的亏：
 * 动画只在值真的变化时才跑，首帧就是目标值。
 */
function values(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.system-xl-semibold')].map(node => node.textContent ?? '')
}

function labels(container: HTMLElement): string[] {
  // 标签行的文字就是标签本身：图标是 `aria-hidden` 的空壳，口径说明在浮层里（没展开时不在文档里）。
  return [...container.querySelectorAll('.mb-1')].map(node => (node.textContent ?? '').trim())
}

beforeEach(() => {
  // 固定语言，避免测试结果依赖运行环境的系统语言。
  useLanguageStore.setState({ preference: 'zh-CN' })
})

describe('StatsGrid', () => {
  it('四格依次是总请求数、成功率、缓存命中率、Token 消耗', () => {
    const { container } = render(<StatsGrid summary={summary()} />, { wrapper })

    expect(labels(container)).toEqual(['总请求数', '成功率', '缓存命中率', 'Token 消耗'])
  })

  it('总请求数带千分位', () => {
    const { container } = render(<StatsGrid summary={summary()} />, { wrapper })

    expect(values(container)[0]).toBe('1,234')
  })

  it('成功率按百分比给一位小数（服务端回的是 0~1 的比例）', () => {
    const { container } = render(<StatsGrid summary={summary()} />, { wrapper })

    expect(values(container)[1]).toBe('98.8%')
  })

  it('缓存命中率也给一位小数的百分比', () => {
    const { container } = render(<StatsGrid summary={summary({ cacheHitRate: 0.432})} />, { wrapper })

    expect(values(container)[2]).toBe('43.2%')
  })

  it('命中率为 null 时写「—」而不是「0.0%」——「没测到」和「一次都没命中」必须分得开', () => {
    const { container } = render(<StatsGrid summary={summary({ cacheHitRate: null })} />, { wrapper })

    expect(values(container)[2]).toBe('—')
  })

  it('命中率真的有 0 时写「0.0%」——那是真实的「测得零」', () => {
    const { container } = render(<StatsGrid summary={summary({ cacheHitRate: 0 })} />, { wrapper })

    expect(values(container)[2]).toBe('0.0%')
  })

  it('Token 消耗按量级换 M / K 单位，十万以下写原数', () => {
    const millions = render(<StatsGrid summary={summary({ totalTokens: 2_500_000 })} />, { wrapper })
    expect(values(millions.container)[3]).toBe('2.5M')
    millions.unmount()

    const thousands = render(<StatsGrid summary={summary({ totalTokens: 12_500 })} />, { wrapper })
    expect(values(thousands.container)[3]).toBe('12.5K')
    thousands.unmount()

    const plain = render(<StatsGrid summary={summary({ totalTokens: 999 })} />, { wrapper })
    expect(values(plain.container)[3]).toBe('999')
  })

  it('命中率那格挂口径说明（怎么算出来的），且是可访问名——读屏用户不会悬停', () => {
    const { container } = render(<StatsGrid summary={summary()} />, { wrapper })

    const hint = container.querySelector('[aria-label]')
    expect(hint?.getAttribute('aria-label')).toContain('缓存读取 Token')
  })

  it('口径是「没测到不是命中率为零」——它解释的是为什么写「—」', () => {
    const { container } = render(<StatsGrid summary={summary()} />, { wrapper })

    expect(container.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('没测到不是命中率为零')
  })

  it('标签行里的图标都是装饰性的（读数靠文字，不靠图标）', () => {
    const { container } = render(<StatsGrid summary={summary()} />, { wrapper })

    // 四格的指标图标 + 命中率那格的口径说明图标。
    const icons = [...container.querySelectorAll('.mb-1 svg')]
    expect(icons).toHaveLength(5)
    expect(icons.every(icon => icon.getAttribute('aria-hidden') !== null)).toBe(true)
  })
})
