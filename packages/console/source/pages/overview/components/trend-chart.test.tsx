// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { UsageTrendPoint } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TrendBars, TrendChart } from './trend-chart'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 柱高不在 DOM 里：recharts 只把算好的矩形画出来。包一层记下交给 `BarChart` 的行，
// 才能断言五段相加是否等于卡片上的「输入 + 输出」。
interface StackedTrendRow extends UsageTrendPoint {
  uncachedInputTokens?: number
  plainOutputTokens?: number
}

const capturedBars = vi.hoisted(() => ({
  rows: null as StackedTrendRow[] | null,
  stackKeys: [] as string[],
}))

interface CapturedBarChartProps {
  data?: StackedTrendRow[]
  children?: ReactNode
}

interface CapturedBarProps {
  dataKey?: string | number
  children?: ReactNode
}

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    BarChart: (props: CapturedBarChartProps) => {
      capturedBars.rows = props.data ?? null
      return <actual.BarChart {...props} />
    },
    Bar: (props: CapturedBarProps) => {
      const dataKey = props.dataKey == null ? null : String(props.dataKey)
      if (dataKey && !capturedBars.stackKeys.includes(dataKey)) capturedBars.stackKeys.push(dataKey)
      return <actual.Bar {...props} />
    },
  }
})

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function point(label: string): UsageTrendPoint {
  return { label, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }
}

describe('TrendChart compatibility', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'zh-CN' })
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

const DISJOINT_STACK_KEYS = [
  'reasoningTokens',
  'plainOutputTokens',
  'cacheCreationInputTokens',
  'cachedInputTokens',
  'uncachedInputTokens',
]

/** 五段相加。卡片上的 Token 总量是同一行的输入加输出，柱高必须与它相等。 */
function stackedTotal(row: StackedTrendRow): number {
  return (row.uncachedInputTokens ?? 0)
    + row.cachedInputTokens
    + row.cacheCreationInputTokens
    + (row.plainOutputTokens ?? 0)
    + row.reasoningTokens
}

describe('TrendBars token stack', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'zh-CN' })
    capturedBars.rows = null
    capturedBars.stackKeys = []
  })

  // 观测层样本：Anthropic `input_tokens: 8` 加上 cache read 7、cache write 5，
  // 落库为 `inputTokens: 20`、`outputTokens: 4`。卡片总量是 24。
  // 缓存已经在输入里，再叠上去柱高是 36。Tooltip 的「输入」仍是总量 20。
  it('缓存已含在输入里，柱段拆开后柱高等于卡片总量', () => {
    const raw: UsageTrendPoint = {
      label: '2026-01-08 10:30',
      inputTokens: 20,
      outputTokens: 4,
      cachedInputTokens: 7,
      cacheCreationInputTokens: 5,
      reasoningTokens: 0,
    }

    render(<TrendBars trend={[raw]} />, { wrapper: Wrapper })

    const row = capturedBars.rows?.[0]
    expect(capturedBars.stackKeys).toEqual(DISJOINT_STACK_KEYS)
    expect(row).toMatchObject({
      inputTokens: 20,
      outputTokens: 4,
      uncachedInputTokens: 8,
      cachedInputTokens: 7,
      cacheCreationInputTokens: 5,
      plainOutputTokens: 4,
      reasoningTokens: 0,
    })
    expect(stackedTotal(row!)).toBe(raw.inputTokens + raw.outputTokens)
  })

  // 上游报的输出含推理 Token。思考再单独占一段时，不能把同一批 Token 加第二次。
  it('思考从输出里拆出来，不再在输出之上叠一份', () => {
    const raw: UsageTrendPoint = {
      label: '2026-01-08 11:00',
      inputTokens: 10,
      outputTokens: 9,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
      reasoningTokens: 3,
    }

    render(<TrendBars trend={[raw]} />, { wrapper: Wrapper })

    const row = capturedBars.rows?.[0]
    expect(row).toMatchObject({
      inputTokens: 10,
      outputTokens: 9,
      uncachedInputTokens: 7,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
      plainOutputTokens: 6,
      reasoningTokens: 3,
    })
    expect(stackedTotal(row!)).toBe(raw.inputTokens + raw.outputTokens)
  })

  // 异常读数里子集可能大于父级。未缓存输入与不含思考的输出不许画成负数。
  it('子集超过父级时，拆出来的剩余截到 0', () => {
    const raw: UsageTrendPoint = {
      label: '2026-01-08 12:00',
      inputTokens: 5,
      outputTokens: 2,
      cachedInputTokens: 4,
      cacheCreationInputTokens: 3,
      reasoningTokens: 9,
    }

    render(<TrendBars trend={[raw]} />, { wrapper: Wrapper })

    const row = capturedBars.rows?.[0]
    expect(row?.uncachedInputTokens).toBe(0)
    expect(row?.plainOutputTokens).toBe(0)
    expect(row?.inputTokens).toBe(5)
    expect(row?.outputTokens).toBe(2)
    expect(row?.cachedInputTokens).toBe(4)
    expect(row?.reasoningTokens).toBe(9)
  })
})
