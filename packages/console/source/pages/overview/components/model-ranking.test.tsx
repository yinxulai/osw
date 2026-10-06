// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ModelStat } from '@common/schemas'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ModelRanking } from './model-ranking'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 「已删除」标签靠这两份软删除 id 集合判断，单测里直接给结果。
const deleted = vi.hoisted(() => ({ providers: new Set<string>(), providerModels: new Set<string>() }))
vi.mock('@/data/providers', () => ({ useDeletedProviderIds: () => deleted.providers }))
vi.mock('@/data/provider-models', () => ({ useDeletedProviderModelIds: () => deleted.providerModels }))

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <TooltipProvider>{props.children}</TooltipProvider>
    </I18nProvider>
  )
}

function modelStat(overrides: Partial<ModelStat> & Pick<ModelStat, 'providerModelId'>): ModelStat {
  return {
    providerModelName: 'gpt-5',
    providerId: 'prov_primary',
    providerName: '主供应商',
    attempts: 10,
    success: 10,
    successRate: 1,
    avgTtftMs: 320,
    avgTps: 24,
    avgOutputTokens: 800,
    cacheHitRate: 0.5,
    outputTokens: 8_000,
    inputTokens: 2_000,
    cachedInputTokens: 1_000,
    ...overrides,
  }
}

/** 表格每一行的单元格文本。 */
function rows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll('tbody tr')].map(row =>
    [...row.querySelectorAll('td')].map(cell => (cell.textContent ?? '').trim()),
  )
}

function headers(container: HTMLElement): string[] {
  return [...container.querySelectorAll('thead th')].map(cell => (cell.textContent ?? '').trim())
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
  deleted.providers = new Set<string>()
  deleted.providerModels = new Set<string>()
})

describe('ModelRanking 的表头', () => {
  it('九列依次是名次、模型、Provider、请求数、平均 TTFT、平均 TPS、平均输出、缓存命中率、成功率', () => {
    const { container } = render(<ModelRanking stats={[modelStat({ providerModelId: 'pm_a' })]} />, { wrapper })

    expect(headers(container)).toEqual([
      '#', '模型', 'Provider', '请求数', '平均 TTFT', '平均 TPS', '平均输出', '缓存命中率', '成功率',
    ])
  })

  it('没有任何模型时给一行横跨九列的「暂无模型请求数据」', () => {
    const { container } = render(<ModelRanking stats={[]} />, { wrapper })

    const cell = container.querySelector('tbody td')
    expect(cell?.textContent).toBe('暂无模型请求数据')
    expect(cell?.getAttribute('colspan')).toBe('9')
  })
})

describe('ModelRanking 的排行榜截断', () => {
  it('只列前 10 名——接口多回几行是因为账单要合并同名模型，截断是榜单自己的事', () => {
    const stats = Array.from({ length: 25 }, (_, index) => modelStat({ providerModelId: `pm_${index}`, providerModelName: `model-${index}` }))

    const { container } = render(<ModelRanking stats={stats} />, { wrapper })

    expect(rows(container)).toHaveLength(10)
  })

  it('名次是「榜上的名次」而不是接口给的行号，第一名前三个用主色徽标', () => {
    const stats = Array.from({ length: 5 }, (_, index) => modelStat({ providerModelId: `pm_${index}` }))

    const { container } = render(<ModelRanking stats={stats} />, { wrapper })

    const ranks = rows(container).map(cells => cells[0])
    expect(ranks).toEqual(['1', '2', '3', '4', '5'])

    const badges = [...container.querySelectorAll('tbody span[class*="rounded-full"]')]
    expect(badges[0].className).toContain('bg-primary')
    expect(badges[2].className).toContain('bg-primary')
    // 第四名开始不再抢主色。
    expect(badges[3].className).toContain('bg-inset')
  })
})

describe('ModelRanking 各列的取值', () => {
  it('请求数跟着语言加千分位；TTFT / TPS / 平均输出各自按统一的展示规则格式化', () => {
    const { container } = render(
      <ModelRanking
        stats={[modelStat({ providerModelId: 'pm_a', attempts: 12_345, avgTtftMs: 1250, avgTps: 3.25, avgOutputTokens: 84.6 })]}
      />,
      { wrapper },
    )

    const cells = rows(container)[0]
    expect(cells[3]).toBe('12,345')
    // 一秒以上的耗时写成秒，保留一位小数。
    expect(cells[4]).toBe('1.3s')
    // 10 以下的速度保留一位小数，10 以上取整——同一个数在别处不能被读成另一个数。
    expect(cells[5]).toBe('3.3')
    expect(cells[6]).toBe('85')
  })

  it('不会重名：速度 24.0 与 24 只会有一种写法', () => {
    const { container } = render(<ModelRanking stats={[modelStat({ providerModelId: 'pm_a', avgTps: 24.04 })]} />, { wrapper })

    expect(rows(container)[0][5]).toBe('24')
  })

  it('没有样本的列写「—」，不写 0（「没测到」和「测得 0」必须分得开）', () => {
    const { container } = render(
      <ModelRanking stats={[modelStat({ providerModelId: 'pm_a', avgTtftMs: null, avgTps: null, avgOutputTokens: null })]} />,
      { wrapper },
    )

    const cells = rows(container)[0]
    expect(cells[4]).toBe('—')
    expect(cells[5]).toBe('—')
    expect(cells[6]).toBe('—')
  })

  it('缓存命中率为 null 时写「—」，有值时才写百分比', () => {
    const absent = render(<ModelRanking stats={[modelStat({ providerModelId: 'pm_a', cacheHitRate: null })]} />, { wrapper })
    expect(rows(absent.container)[0][7]).toBe('—')
    absent.unmount()

    const present = render(<ModelRanking stats={[modelStat({ providerModelId: 'pm_a', cacheHitRate: 0.432 })]} />, { wrapper })
    expect(rows(present.container)[0][7]).toBe('43.2%')
  })

  it('成功率按 95% / 80% 两档换徽标颜色（一眼看出哪几个掉队）', () => {
    const { container } = render(
      <ModelRanking
        stats={[
          modelStat({ providerModelId: 'pm_a', successRate: 0.99 }),
          modelStat({ providerModelId: 'pm_b', successRate: 0.85 }),
          modelStat({ providerModelId: 'pm_c', successRate: 0.5 }),
        ]}
      />,
      { wrapper },
    )

    const badges = [...container.querySelectorAll('tbody [data-slot="badge"]')]
    expect(badges.map(badge => badge.getAttribute('data-variant'))).toEqual(['success', 'warning', 'destructive'])
    expect(badges[0].textContent).toBe('99.0%')
  })

  it('成功率正好压在分界线上时算好的一档（0.95 是 success，0.8 是 warning）', () => {
    const { container } = render(
      <ModelRanking
        stats={[
          modelStat({ providerModelId: 'pm_a', successRate: 0.95 }),
          modelStat({ providerModelId: 'pm_b', successRate: 0.8 }),
        ]}
      />,
      { wrapper },
    )

    const badges = [...container.querySelectorAll('tbody [data-slot="badge"]')]
    expect(badges.map(badge => badge.getAttribute('data-variant'))).toEqual(['success', 'warning'])
  })
})

describe('ModelRanking 的「已删除」标记', () => {
  it('供应商已被软删除时补一个「已删除」标签——统计里的名字是写入当时的快照', () => {
    deleted.providers = new Set(['prov_gone'])
    const { container } = render(
      <ModelRanking stats={[modelStat({ providerModelId: 'pm_a', providerId: 'prov_gone', providerName: '已拆的供应商' })]} />,
      { wrapper },
    )

    expect(container.textContent).toContain('已拆的供应商')
    expect(container.textContent).toContain('已删除')
  })

  it('供应商模型已被软删除时同样补标签', () => {
    deleted.providerModels = new Set(['pm_gone'])
    const { container } = render(<ModelRanking stats={[modelStat({ providerModelId: 'pm_gone' })]} />, { wrapper })

    expect(container.textContent).toContain('已删除')
  })

  it('都还在时一个标签都不加（它是纯展示，不拦任何操作）', () => {
    const { container } = render(<ModelRanking stats={[modelStat({ providerModelId: 'pm_a' })]} />, { wrapper })

    expect(container.textContent).not.toContain('已删除')
  })
})
