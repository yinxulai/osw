// @vitest-environment jsdom

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateRangePicker, type DateRangeValue } from '@/components/date-range-picker'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'

/*
 * 日期区间选择器。
 *
 * 守两条：空值走占位而不是显示「1970」，预设点一下给出的两端确实是「含首含尾的本地零点」。
 * 时刻的换算（结束日 +1 天之类）是各调用方自己的口径，不在这里测。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

/** 受控包装的入参：内联的对象字面量类型不只是风格问题，规则也会拦，所以必须具名。 */
interface ControlledProps {
  initial: DateRangeValue
  onChange: (next: DateRangeValue) => void
}

/** 受控包装：把 `onChange` 的回写接到本地 state，模拟真实调用方的行为。 */
function Controlled(props: ControlledProps) {
  const { initial, onChange } = props
  const [value, setValue] = React.useState(initial)
  return (
    <I18nProvider>
      <DateRangePicker
        label="时间范围"
        value={value}
        onChange={next => {
          onChange(next)
          setValue(next)
        }}
      />
    </I18nProvider>
  )
}

function wrap(value: DateRangeValue = { from: null, to: null }) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  const onChange = vi.fn()
  render(<Controlled initial={value} onChange={onChange} />)
  return onChange
}

/** 点开弹层后的所有「天」按钮（跨两联日历）。`data-day` 在单元格 `<td>` 上也有，这里只取按钮。 */
function dayButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button[data-day]')]
}

/** 某个日期本地零点的毫秒时间戳。 */
function midnightOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

describe('日期区间选择器', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('未选日期时按钮显示占位文案', () => {
    wrap()
    expect(screen.getByRole('combobox', { name: '时间范围' }).textContent).toContain('选择日期范围')
  })

  it('已选日期时按钮显示两端', () => {
    const from = midnightOf(new Date(2026, 0, 1))
    const to = midnightOf(new Date(2026, 0, 15))
    wrap({ from, to })

    const text = screen.getByRole('combobox', { name: '时间范围' }).textContent ?? ''
    expect(text).toContain('2026')
    expect(text).not.toContain('选择日期范围')
  })

  it('点「近 7 天」给出的区间是含首含尾的本地零点', () => {
    const onChange = wrap()

    fireEvent.click(screen.getByRole('combobox', { name: '时间范围' }))
    fireEvent.click(screen.getByRole('button', { name: '近 7 天' }))

    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6).getTime()
    expect(onChange).toHaveBeenCalledWith({ from, to: end })
  })

  it('近 7 天跨春令时从第 7 个日历日起，而不是再往前一天', () => {
    const previousTz = process.env.TZ
    process.env.TZ = 'America/New_York'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 14, 12))
    try {
      // 这条断言本身要求时区真的有夏令时，否则 24 小时减法碰巧也对，用例会空过。
      expect(new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime()).toBe(23 * 60 * 60 * 1000)
      const onChange = wrap()

      fireEvent.click(screen.getByRole('combobox', { name: '时间范围' }))
      fireEvent.click(screen.getByRole('button', { name: '近 7 天' }))

      expect(onChange).toHaveBeenCalledWith({
        from: new Date(2026, 2, 8).getTime(),
        to: new Date(2026, 2, 14).getTime(),
      })
    } finally {
      if (previousTz === undefined) delete process.env.TZ
      else process.env.TZ = previousTz
    }
  })

  it('单击一天只给出「有起点没终点」的半区间，弹层不关闭', () => {
    const onChange = wrap()

    fireEvent.click(screen.getByRole('combobox', { name: '时间范围' }))
    const days = dayButtons()
    expect(days.length).toBeGreaterThan(1)

    fireEvent.click(days[10])

    // 向调用方交出去的是半区间：有起点、没终点。如果这里给的是「首尾同一天」的伪完整区间，
    // 调用方会当成「选完了」而关窗，用户就点不到另一头。
    expect(onChange).toHaveBeenCalledWith({ from: expect.any(Number), to: null })
    // 选了一头就该能接着选另一头——弹层必须留着。
    expect(screen.getByRole('combobox', { name: '时间范围' }).getAttribute('aria-expanded')).toBe('true')
    // 此刻日历里就该只有「一个」高亮点（起点），没有终点、没有中间夹层。
    expect(document.querySelectorAll('[data-range-end="true"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-range-middle="true"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-selected-single="true"]')).toHaveLength(1)
  })

  it('选满两头才收窗', () => {
    const onChange = wrap()

    fireEvent.click(screen.getByRole('combobox', { name: '时间范围' }))
    fireEvent.click(dayButtons()[10])
    // 第一次点击后 DOM 会重排，重新取一次节点。
    fireEvent.click(dayButtons()[13])

    const last = onChange.mock.calls.at(-1)?.[0] as DateRangeValue
    expect(last.from).not.toBeNull()
    expect(last.to).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '时间范围' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('完整区间的日历只标记首尾两天，中间天不算额外端点', () => {
    const from = midnightOf(new Date(2026, 4, 10))
    const to = midnightOf(new Date(2026, 4, 13))
    wrap({ from, to })

    fireEvent.click(screen.getByRole('combobox', { name: '时间范围' }))

    expect(document.querySelectorAll('[data-range-start="true"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-range-end="true"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-range-middle="true"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-selected-single="true"]')).toHaveLength(0)
  })
})
