// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

/**
 * 这个 ref 不是洁癖：Radix 的 `asChild` 触发器（`DropdownMenuTrigger` / `TooltipTrigger` …）
 * 靠它拿到浮层锚点，接不住 ref 时浮层会被摆到视口外（`translate(0, -200%)`），
 * 在界面上表现成「点了没反应」。类型检查与 lint 都看不出这件事，只能这么钉住。
 */
describe('Button ref', () => {
  it('把 ref 落到真实 button 上', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>开始诊断</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('asChild 时把 ref 落到插槽子元素上', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button asChild ref={ref}>
        <a href="#target">链接</a>
      </Button>,
    )
    expect(ref.current?.tagName).toBe('A')
  })
})
