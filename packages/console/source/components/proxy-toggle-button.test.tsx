// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'

/*
 * 启停服务按钮。
 *
 * 这个按钮承担两个状态下的两种文案：停下时的「启动服务」（悬停补一个箭头）、
 * 运行中的「运行中」（悬停换成「暂停服务」+ 暂停图标）。
 * 两个属性（aria-label / title）都要跟着状态走——读屏和鼠标悬停各自读到的那句话
 * 必须描述「点下去会发生什么」，而不是描述当前状态。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

function wrap(children: React.ReactNode) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(<I18nProvider>{children}</I18nProvider>)
}

describe('启停服务按钮', () => {
  it('未运行时文案是「启动服务」', () => {
    wrap(<ProxyToggleButton running={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('运行中')).toBeNull()
    expect(screen.getAllByText('启动服务').length).toBeGreaterThan(0)
  })

  it('运行中时文案是「运行中」，悬停内容给出「暂停服务」', () => {
    wrap(<ProxyToggleButton running={true} onToggle={vi.fn()} />)

    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('暂停服务')).toBeTruthy()
  })

  it('无障碍名描述的是「点下去会发生什么」，不是当前状态', () => {
    const { rerender } = wrap(<ProxyToggleButton running={false} onToggle={vi.fn()} />)
    expect(screen.getByLabelText('启动服务')).toBeTruthy()

    rerender(
      <I18nProvider>
        <ProxyToggleButton running={true} onToggle={vi.fn()} />
      </I18nProvider>,
    )
    expect(screen.getByLabelText('暂停服务')).toBeTruthy()
  })

  it('title 比 aria-label 更具体（说明作用范围是本地代理服务）', () => {
    const { rerender } = wrap(<ProxyToggleButton running={false} onToggle={vi.fn()} />)
    expect(screen.getByLabelText('启动服务').getAttribute('title')).toBe('启动本地代理服务')

    rerender(
      <I18nProvider>
        <ProxyToggleButton running={true} onToggle={vi.fn()} />
      </I18nProvider>,
    )
    expect(screen.getByLabelText('暂停服务').getAttribute('title')).toBe('暂停本地代理服务')
  })

  it('点击触发一次回调', () => {
    const onToggle = vi.fn()
    wrap(<ProxyToggleButton running={false} onToggle={onToggle} />)

    fireEvent.click(screen.getByLabelText('启动服务'))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('回调是异步的也不会把错误抛到渲染里（组件用 void 接住）', () => {
    const onToggle = vi.fn(() => Promise.resolve())
    wrap(<ProxyToggleButton running={false} onToggle={onToggle} />)

    expect(() => fireEvent.click(screen.getByLabelText('启动服务'))).not.toThrow()
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('运行中时悬停内容带一个暂停图标', () => {
    const { container } = wrap(<ProxyToggleButton running={true} onToggle={vi.fn()} />)

    expect(container.querySelector('.lucide-pause')).toBeTruthy()
  })

  it('未运行时悬停内容用默认箭头（没有暂停图标）', () => {
    const { container } = wrap(<ProxyToggleButton running={false} onToggle={vi.fn()} />)

    expect(container.querySelector('.lucide-pause')).toBeNull()
    expect(container.querySelector('.lucide-arrow-right')).toBeTruthy()
  })
})
