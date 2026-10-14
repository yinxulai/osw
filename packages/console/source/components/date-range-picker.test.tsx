// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DateRangePicker } from '@/components/date-range-picker'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'

/*
 * 日期区间选择器。
 *
 * 守两条：空值走占位而不是显示「1970」，预设点一下给出的两端确实是「含首含尾的本地零点」。
 * 时刻的换算（结束日 +1 天之类）是各调用方自己的口径，不在这里测。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

function wrap(value: { from: number | null; to: number | null } = { from: null, to: null }) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  const onChange = vi.fn()
  render(
    <I18nProvider>
      <DateRangePicker label="时间范围" value={value} onChange={onChange} />
    </I18nProvider>,
  )
  return onChange
}

/** 某个日期本地零点的毫秒时间戳。 */
function midnightOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

describe('日期区间选择器', () => {
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

    const end = midnightOf(new Date())
    expect(onChange).toHaveBeenCalledWith({ from: end - 6 * 24 * 60 * 60 * 1000, to: end })
  })
})
