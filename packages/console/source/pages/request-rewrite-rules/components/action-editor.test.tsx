// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REWRITE_SCRIPT_TIMEOUT_DEFAULT } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import type { RuleAction } from '../types'
import { ActionEditor } from './action-editor'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function scriptAction(timeoutMilliseconds: number): RuleAction {
  return {
    id: 'action-script',
    stage: 'request',
    target: 'script',
    operation: 'set',
    path: '',
    code: 'while (true) {}',
    timeoutMilliseconds,
  }
}

function timeoutInput() {
  return screen.getByLabelText('Timeout (ms)') as HTMLInputElement
}

/**
 * `onChange` 写回的是表单草稿。不把草稿接回 `actions` 的话，输入框仍显示原来的 props，
 * 失焦把超时改成默认值这件事在界面上看不出来。
 */
function renderScriptTimeout(timeoutMilliseconds: number) {
  const onChange = vi.fn()
  function Harness() {
    const [actions, setActions] = useState<RuleAction[]>([scriptAction(timeoutMilliseconds)])
    return (
      <ActionEditor
        actions={actions}
        onChange={next => {
          onChange(next)
          setActions(next)
        }}
      />
    )
  }
  render(<Harness />, { wrapper: Wrapper })
  return { onChange }
}

function committedTimeout(onChange: ReturnType<typeof vi.fn>): number | undefined {
  const actions = onChange.mock.calls.at(-1)?.[0] as RuleAction[] | undefined
  return actions?.[0]?.timeoutMilliseconds
}

describe('ActionEditor script timeout', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('没有改过数字就失焦时保持已保存的超时', () => {
    const { onChange } = renderScriptTimeout(5000)

    expect(timeoutInput().value).toBe('5000')
    fireEvent.blur(timeoutInput())

    expect(onChange).not.toHaveBeenCalled()
    expect(timeoutInput().value).toBe('5000')
  })

  it('改过的数字在失焦时写回，之后再失焦不再改掉', () => {
    const { onChange } = renderScriptTimeout(5000)

    fireEvent.change(timeoutInput(), { target: { value: '1500' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(timeoutInput())

    expect(committedTimeout(onChange)).toBe(1500)
    expect(timeoutInput().value).toBe('1500')

    fireEvent.blur(timeoutInput())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(timeoutInput().value).toBe('1500')
  })

  it('清空后失焦仍回退到默认值，输入框显示归一后的数字', () => {
    const { onChange } = renderScriptTimeout(5000)

    fireEvent.change(timeoutInput(), { target: { value: '' } })
    fireEvent.blur(timeoutInput())

    expect(committedTimeout(onChange)).toBe(REWRITE_SCRIPT_TIMEOUT_DEFAULT)
    expect(timeoutInput().value).toBe(String(REWRITE_SCRIPT_TIMEOUT_DEFAULT))
  })
})
