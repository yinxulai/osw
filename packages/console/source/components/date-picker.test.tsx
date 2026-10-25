// @vitest-environment jsdom

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatePicker } from '@/components/date-picker'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'

/*
 * 单日选择器。
 *
 * 守三件事：空值是「永不过期」这个占位而不是空白；选一天交出去的是 `YYYY-MM-DD` 本地日期串；
 * 底部那个动作把值打回空串。时刻口径（到期日取当天结束）不在这里测，那是调用方 `draft.ts` 的事。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

/** 受控包装的入参：内联的对象字面量类型不只是风格问题，规则也会拦，所以必须具名。 */
interface ControlledProps {
  initial: string
  onChange: (next: string) => void
}

/** 受控包装：把 `onChange` 的回写接到本地 state，模拟真实调用方的行为。 */
function Controlled(props: ControlledProps) {
  const { initial, onChange } = props
  const [value, setValue] = React.useState(initial)
  return (
    <I18nProvider>
      <DatePicker
        label="过期日期"
        placeholder="永不过期"
        clearLabel="永不过期"
        value={value}
        onChange={next => {
          onChange(next)
          setValue(next)
        }}
      />
    </I18nProvider>
  )
}

function wrap(value = '') {
  useLanguageStore.setState({ preference: 'zh-CN' })
  const onChange = vi.fn()
  render(<Controlled initial={value} onChange={onChange} />)
  return onChange
}

function trigger(): HTMLElement {
  return screen.getByRole('combobox', { name: '过期日期' })
}

/** 点开弹层后的所有「天」按钮。`data-day` 在单元格 `<td>` 上也有，这里只取按钮。 */
function dayButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button[data-day]')]
}

describe('单日选择器', () => {
  it('未选日期时按钮显示占位文案', () => {
    wrap()
    expect(trigger().textContent).toContain('永不过期')
  })

  it('已选日期时显示日期，不再是占位', () => {
    wrap('2026-01-31')
    const text = trigger().textContent ?? ''
    expect(text).toContain('2026')
    expect(text).not.toContain('永不过期')
  })

  it('选一天交出去的是 `YYYY-MM-DD`，并收起弹层', () => {
    const onChange = wrap()

    fireEvent.click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')

    const days = dayButtons()
    expect(days.length).toBeGreaterThan(1)
    fireEvent.click(days[10])

    const value = onChange.mock.calls.at(-1)?.[0] as string
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 单选没有「还差另一头」的中间态，选完就该收窗。
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('底部动作把值打回空串', () => {
    const onChange = wrap('2026-01-31')

    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: '永不过期' }))

    expect(onChange).toHaveBeenCalledWith('')
    expect(trigger().textContent).toContain('永不过期')
  })

  it('空值时底部动作是禁用的', () => {
    wrap()

    fireEvent.click(trigger())
    expect((screen.getByRole('button', { name: '永不过期' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
