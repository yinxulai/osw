// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FailureReasonStat } from '@common/schemas'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { FailureReasons } from './failure-reasons'

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

function reason(overrides: Partial<FailureReasonStat> & Pick<FailureReasonStat, 'reason'>): FailureReasonStat {
  return { count: 1, percent: 100, ...overrides }
}

/** 卡片副标题（`data-slot="card-description"`）。 */
function description(container: HTMLElement): string {
  return container.querySelector('[data-slot="card-description"]')?.textContent ?? ''
}

beforeEach(() => {
  // 固定语言，避免测试结果依赖运行环境的系统语言。
  useLanguageStore.setState({ preference: 'zh-CN' })
})

describe('FailureReasons 的卡片结构', () => {
  it('标题是「错误分布」', () => {
    const { container } = render(<FailureReasons reasons={[]} failedCount={0} />, { wrapper })

    expect(container.querySelector('[data-slot="card-title"]')?.textContent).toBe('错误分布')
  })

  it('没有失败请求时给一句「当前时间范围内暂无失败请求」，而不是空卡片', () => {
    const { container } = render(<FailureReasons reasons={[]} failedCount={0} />, { wrapper })

    expect(container.textContent).toContain('当前时间范围内暂无失败请求')
    // 没有失败是好事，配一个对勾而不是感叹号。
    expect(container.textContent).toContain('✓')
  })

  it('没有失败请求时不画堆叠条，也不列原因', () => {
    const { container } = render(<FailureReasons reasons={[]} failedCount={0} />, { wrapper })

    expect(container.querySelector('[title]')).toBeNull()
  })
})

describe('FailureReasons 的副标题', () => {
  it('只给失败数时写「共 N 个最终失败请求」', () => {
    const { container } = render(<FailureReasons reasons={[reason({ reason: 'TIMEOUT' })]} failedCount={1234} />, { wrapper })

    expect(description(container)).toBe('共 1,234 个最终失败请求')
  })

  it('给了总请求数时改写成「共 N 次失败 · 失败率 X%」', () => {
    const { container } = render(
      <FailureReasons reasons={[reason({ reason: 'TIMEOUT' })]} failedCount={5} totalRequests={200} />,
      { wrapper },
    )

    expect(description(container)).toBe('共 5 次失败 · 失败率 2.50%')
  })

  it('失败率保留两位小数（1/3 这类值不能被抹成 0.3%）', () => {
    const { container } = render(
      <FailureReasons reasons={[reason({ reason: 'TIMEOUT' })]} failedCount={1} totalRequests={3} />,
      { wrapper },
    )

    expect(description(container)).toBe('共 1 次失败 · 失败率 33.33%')
  })

  it('给了总请求数但一个请求都没有时写 0.00% 而不是 NaN', () => {
    const { container } = render(<FailureReasons reasons={[]} failedCount={0} totalRequests={0} />, { wrapper })

    expect(description(container)).toBe('共 0 次失败 · 失败率 0.00%')
  })
})

describe('FailureReasons 的原因列表', () => {
  it('按分类码翻成中文标签（库里存的是机器码，语言不进数据库）', () => {
    const { container } = render(
      <FailureReasons
        reasons={[reason({ reason: 'TIMEOUT', percent: 60 }), reason({ reason: 'RATE_LIMITED', count: 2, percent: 40 })]}
        failedCount={5}
      />,
      { wrapper },
    )

    expect(container.textContent).toContain('超时')
    expect(container.textContent).toContain('限流 (429)')
  })

  it('每行的次数跟随语言加千分位，百分比照抄服务端给的整数', () => {
    const { container } = render(
      <FailureReasons reasons={[reason({ reason: 'SERVER_ERROR', count: 12345, percent: 78 })]} failedCount={12345} />,
      { wrapper },
    )

    expect(container.textContent).toContain('12,345')
    expect(container.textContent).toContain('78%')
  })

  it('堆叠条每段带一条「原因：N 次（P%）」的悬停说明，段宽就是百分比', () => {
    const { container } = render(
      <FailureReasons
        reasons={[reason({ reason: 'TIMEOUT', count: 3, percent: 60 }), reason({ reason: 'OTHER', count: 2, percent: 40 })]}
        failedCount={5}
      />,
      { wrapper },
    )

    const segments = [...container.querySelectorAll('[title]')]
    expect(segments).toHaveLength(2)
    expect(segments[0].getAttribute('title')).toBe('超时：3 次（60%）')
    expect(segments[0].getAttribute('style')).toContain('width: 60%')
    expect(segments[1].getAttribute('style')).toContain('width: 40%')
  })

  it('颜色按配色表顺序取（第一段红、第二段橙），同类颜色在色块与文字行里一致', () => {
    const { container } = render(
      <FailureReasons
        reasons={[reason({ reason: 'TIMEOUT', percent: 60 }), reason({ reason: 'RATE_LIMITED', percent: 40 })]}
        failedCount={2}
      />,
      { wrapper },
    )

    const segments = [...container.querySelectorAll('[title]')]
    expect(segments[0].className).toContain('bg-red-500')
    expect(segments[1].className).toContain('bg-orange-500')

    // 列表左边的小色块与堆叠条一一对应，否则读者没法把条和行对上。
    const swatches = [container.querySelector('span[class*="bg-red-500"]'), container.querySelector('span[class*="bg-orange-500"]')]
    expect(swatches.every(swatch => swatch !== null)).toBe(true)
  })
})
