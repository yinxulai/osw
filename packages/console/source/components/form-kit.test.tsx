// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  FORM_DIALOG_BODY_CLASSNAME,
  FormField,
  FormGrid,
  FormGroup,
  FormHint,
  FormRow,
  FormSection,
  FormSelect,
  FormSwitchRow,
} from './form-kit'

/*
 * 全应用表单的通用基元。
 *
 * 这些组件没有状态、没有副作用，唯一值得钉住的是几条**语义**约定 ——
 * 它们一旦破掉，破的是一整片页面（每个表单都用这套）：
 *
 * 1. `FormField` 的标签必须真的 `htmlFor` 指到控件上，点标签要能聚焦；
 * 2. 说明与错误**互斥**，有错误时不显示说明（否则一行灰字一行红字，人只读得到灰的）；
 * 3. 必填星号是给正常人看的装饰，不能污染标签的可访问名（读屏会念出「星号」）；
 * 4. `FormRow` 没有控件时不留空容器；`FormSelect` 的禁用要落到触发器上而非只改样式。
 */

describe('字段说明', () => {
  it('默认是次级灰字，warning / destructive 各换一种颜色', () => {
    const { container, rerender } = render(<FormHint>普通说明</FormHint>)
    expect(container.firstElementChild?.className).toContain('text-text-tertiary')

    rerender(<FormHint tone="warning">注意</FormHint>)
    expect(container.firstElementChild?.className).toContain('text-text-warning')

    rerender(<FormHint tone="destructive">出错</FormHint>)
    expect(container.firstElementChild?.className).toContain('text-text-destructive')
  })
})

describe('表单字段', () => {
  it('标签与控件用 htmlFor 绑在一起（点标签能聚焦到控件）', () => {
    render(
      <FormField label="端点地址" htmlFor="endpoint">
        <input id="endpoint" />
      </FormField>,
    )

    expect(screen.getByLabelText('端点地址')).toBe((screen.getByRole('textbox')) as HTMLInputElement)
  })

  it('必填星号是标签文字的一部分，所以可访问名里也带着它（读屏能念出「必填」的信号）', () => {
    render(
      <FormField label="密钥" required htmlFor="key">
        <input id="key" />
      </FormField>,
    )

    // 星号在 `label` 里面，所以它就是可访问名的一部分；用正则拼前缀去取。
    const control = screen.getByLabelText(/^密钥/) as HTMLInputElement
    expect(control.id).toBe('key')
    expect(control.closest('div')?.textContent).toContain('*')
    // 偶然的后果：精确匹配「密钥」取不到（名字里多了个星号）。
    expect(screen.queryByLabelText('密钥')).toBeNull()
  })

  it('有错误时只显示错误，说明让位（一行红字比一灰一红更好读）', () => {
    render(
      <FormField label="端口" hint="默认 8080" error="必须是数字">
        <input />
      </FormField>,
    )

    expect(screen.getByText('必须是数字')).toBeTruthy()
    expect(screen.queryByText('默认 8080')).toBeNull()
  })

  it('没有错误时显示说明', () => {
    render(
      <FormField label="端口" hint="默认 8080">
        <input />
      </FormField>,
    )
    expect(screen.getByText('默认 8080')).toBeTruthy()
  })

  it('两者都不给就不留空段落', () => {
    const { container } = render(
      <FormField label="端口">
        <input />
      </FormField>,
    )
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})

describe('字段网格', () => {
  it('列数落到真实类名上，默认两列', () => {
    const { container, rerender } = render(<FormGrid><span>a</span></FormGrid>)
    expect(container.firstElementChild?.className).toContain('sm:grid-cols-2')

    for (const [columns, expected] of [[1, 'grid-cols-1'], [3, 'sm:grid-cols-3'], [4, 'lg:grid-cols-4']] as const) {
      rerender(<FormGrid columns={columns}><span>a</span></FormGrid>)
      expect(container.firstElementChild?.className).toContain(expected)
    }
  })

  it('空网格也必须保留容器（空状态要靠它占位）', () => {
    const { container } = render(<FormGrid />)
    expect(container.firstElementChild).toBeTruthy()
  })
})

describe('表单分组', () => {
  it('没有标题说明动作时，只有内容、不留一条空标题行', () => {
    const { container } = render(<FormGroup><span>内容</span></FormGroup>)

    // 直接子元素只有内容本身（多出一层就说明标题行被渲染了）。
    const children = Array.from(container.firstElementChild?.children ?? [])
    expect(children).toHaveLength(1)
    expect(children[0].tagName).toBe('SPAN')
  })

  it('标题、说明、动作各就各位', () => {
    render(
      <FormGroup title="代理" description="出站代理设置" action={<button type="button">重置</button>}>
        <span>内容</span>
      </FormGroup>,
    )

    expect(screen.getByText('代理')).toBeTruthy()
    expect(screen.getByText('出站代理设置')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重置' })).toBeTruthy()
  })

  it('锚点 id 透传（设置页用它做页内跳转）', () => {
    const { container } = render(<FormGroup id="proxy-section"><span>内容</span></FormGroup>)
    expect(container.querySelector('#proxy-section')).toBeTruthy()
  })
})

describe('表单区块', () => {
  it('白底 + 模块边框，把整组圈成一个模块', () => {
    const { container } = render(<FormSection title="出站代理"><span>内容</span></FormSection>)
    const className = container.firstElementChild?.className ?? ''
    expect(className).toContain('border-module-border')
    expect(className).toContain('bg-card')
  })

  it('外部类名是在分组基础上叠加，不是覆盖掉边框', () => {
    const { container } = render(<FormSection className="mt-2"><span>内容</span></FormSection>)
    const className = container.firstElementChild?.className ?? ''
    expect(className).toContain('mt-2')
    expect(className).toContain('border-module-border')
  })
})

describe('设置行', () => {
  it('左标题说明、右控件', () => {
    render(
      <FormRow title="自动更新" description="启动时检查新版本" control={<button type="button">检查</button>} />,
    )

    expect(screen.getByText('自动更新')).toBeTruthy()
    expect(screen.getByText('启动时检查新版本')).toBeTruthy()
    expect(screen.getByRole('button', { name: '检查' })).toBeTruthy()
  })

  it('不传控件就是纯说明行，不留空容器', () => {
    const { container } = render(<FormRow title="版本" description="1.1.0" />)
    expect(screen.getByText('版本')).toBeTruthy()
    expect(container.querySelector('button')).toBeNull()
    // 外层 + 文字列 + 标题，共三层；多出来的第四层就是为控件预留的空盒子。
    expect(container.querySelectorAll('div')).toHaveLength(3)
  })

  it('错误与说明可以同时出现（错误是叠加的一条，不是替换）', () => {
    render(<FormRow title="端口" description="默认 8080" error="端口已被占用" />)
    expect(screen.getByText('默认 8080')).toBeTruthy()
    expect(screen.getByText('端口已被占用')).toBeTruthy()
  })
})

describe('开关行', () => {
  it('点开关把状态交出去', () => {
    const onCheckedChange = vi.fn()
    render(<FormSwitchRow label="启用重试" description="失败时自动重试" checked={false} onCheckedChange={onCheckedChange} />)

    expect(screen.getByText('启用重试')).toBeTruthy()
    expect(screen.getByText('失败时自动重试')).toBeTruthy()

    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('禁用时点不动（例如缺权限）', () => {
    const onCheckedChange = vi.fn()
    render(<FormSwitchRow label="启用重试" checked={false} disabled onCheckedChange={onCheckedChange} />)

    const control = screen.getByRole('switch') as HTMLButtonElement
    expect(control.disabled).toBe(true)
    fireEvent.click(control)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('已开启时开关处于选中态', () => {
    render(<FormSwitchRow label="启用重试" checked onCheckedChange={() => {}} />)
    expect(screen.getByRole('switch').getAttribute('data-state')).toBe('checked')
  })
})

describe('受控下拉', () => {
  it('已选值直接显示在触发器上，不必展开', () => {
    render(
      <FormSelect
        value="zh-CN"
        onValueChange={() => {}}
        options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
        ariaLabel="界面语言"
      />,
    )

    expect(screen.getByLabelText('界面语言').textContent).toContain('简体中文')
  })

  it('没选值时显示占位符', () => {
    render(
      <FormSelect value="" onValueChange={() => {}} options={[]} placeholder="请选择范围" ariaLabel="范围" />,
    )
    expect(screen.getByLabelText('范围').textContent).toContain('请选择范围')
  })

  it('禁用时触发器点不开', () => {
    render(
      <FormSelect
        value="a"
        onValueChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
        disabled
        ariaLabel="不可用"
      />,
    )

    const trigger = screen.getByLabelText('不可用') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    fireEvent.click(trigger)
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('弹窗正文容器的高度约定是导出常量（各处弹窗共用同一个值）', () => {
    expect(FORM_DIALOG_BODY_CLASSNAME).toContain('max-h-[65vh]')
    expect(FORM_DIALOG_BODY_CLASSNAME).toContain('overflow-y-auto')
  })
})
