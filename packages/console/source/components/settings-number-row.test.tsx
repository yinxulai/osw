// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsNumberRow } from './settings-number-row'

const PROPS = {
  title: '绑定保持',
  description: '会话空闲超过该时长后绑定作废。',
  suffix: '秒',
  placeholder: '900',
  min: 60,
  max: 86400,
  rangeErrorText: '请输入 60 到 86400 之间的整数',
}

function input() {
  return screen.getByLabelText('绑定保持') as HTMLInputElement
}

describe('SettingsNumberRow', () => {
  it('编辑期间草稿自由停留：低于下限的中间态不被抬成下限值，只显示越界提示', () => {
    const onChange = vi.fn()
    render(<SettingsNumberRow {...PROPS} value={900} onChange={onChange} />)

    fireEvent.change(input(), { target: { value: '9' } })

    expect(input().value).toBe('9')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('请输入 60 到 86400 之间的整数')).toBeTruthy()
    expect(input().getAttribute('aria-invalid')).toBe('true')
  })

  it('草稿补到合法值后提示消失，blur 时才写回设置', () => {
    // mock 的 onChange 不会像真实父组件那样更新 value prop，用受控 harness 走完整闭环。
    function Harness() {
      const [value, setValue] = useState(900)
      return <SettingsNumberRow {...PROPS} value={value} onChange={setValue} />
    }
    render(<Harness />)

    fireEvent.change(input(), { target: { value: '9' } })
    fireEvent.change(input(), { target: { value: '90' } })
    expect(screen.queryByText('请输入 60 到 86400 之间的整数')).toBeNull()
    expect(input().value).toBe('90')

    fireEvent.blur(input())
    expect(input().value).toBe('90')
  })

  it('Enter 提交与 blur 等价，越界草稿在提交时收敛到区间', () => {
    const onChange = vi.fn()
    render(<SettingsNumberRow {...PROPS} value={900} onChange={onChange} />)

    fireEvent.change(input(), { target: { value: '30' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(60)
  })

  it('提交时对小数取整', () => {
    const onChange = vi.fn()
    render(<SettingsNumberRow {...PROPS} value={900} onChange={onChange} />)

    fireEvent.change(input(), { target: { value: '90.5' } })
    fireEvent.blur(input())
    expect(onChange).toHaveBeenCalledWith(91)
  })

  it('空草稿或非法草稿提交时回退显示原值，不写设置', () => {
    const onChange = vi.fn()
    render(<SettingsNumberRow {...PROPS} value={900} onChange={onChange} />)

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(onChange).not.toHaveBeenCalled()
    expect(input().value).toBe('900')

    fireEvent.change(input(), { target: { value: 'abc' } })
    fireEvent.blur(input())
    expect(onChange).not.toHaveBeenCalled()
    expect(input().value).toBe('900')
  })

  it('初始设置值越界（如手改配置文件）时直接提示', () => {
    const onChange = vi.fn()
    render(<SettingsNumberRow {...PROPS} value={5} onChange={onChange} />)

    expect(screen.getByText('请输入 60 到 86400 之间的整数')).toBeTruthy()
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('下限为 1000 的字段同样能敲出 2000：草稿逐键自由，提交一次收敛', () => {
    const onChange = vi.fn()
    render(
      <SettingsNumberRow
        {...PROPS}
        title="空闲超时"
        rangeErrorText="请输入 1000 到 600000 之间的整数"
        min={1000}
        max={600000}
        value={30000}
        onChange={onChange}
      />,
    )
    const timeoutInput = screen.getByLabelText('空闲超时') as HTMLInputElement

    fireEvent.change(timeoutInput, { target: { value: '2' } })
    expect(timeoutInput.value).toBe('2')
    fireEvent.change(timeoutInput, { target: { value: '2000' } })
    fireEvent.blur(timeoutInput)

    expect(onChange).toHaveBeenCalledWith(2000)
  })
})
