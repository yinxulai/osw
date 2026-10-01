// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ThemeModeMenu } from './theme-mode-menu'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// Radix 的菜单在 jsdom 里默认活不起来：打开挂在 pointer 事件上（jsdom 的 click 不带指针
// 语义），菜单项要滚动定位，触发器要报指针捕获。真实浏览器都有这些，桩掉即可。
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false
  window.HTMLElement.prototype.releasePointerCapture = () => {}
  window.HTMLElement.prototype.scrollIntoView = () => {}
})

/** 菜单的打开在 `onPointerDown`（`fireEvent.click` 不触发），测试里统一走这个入口。 */
function openThemeMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Theme mode' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })
}

interface ThemeMenuHarnessProps {
  themeMode: 'light' | 'dark' | 'system'
  onChange: (mode: 'light' | 'dark' | 'system') => void
}

function ThemeMenuHarness(props: ThemeMenuHarnessProps) {
  return (
    <I18nProvider>
      <ThemeModeMenu
        theme={props.themeMode === 'system' ? 'light' : props.themeMode}
        themeMode={props.themeMode}
        onThemeModeChange={props.onChange}
      >
        <span>当前模式</span>
      </ThemeModeMenu>
    </I18nProvider>
  )
}

describe('ThemeModeMenu', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'en' })
  })

  it('菜单里三态齐全，当前偏好勾选、其余不勾', () => {
    render(<ThemeMenuHarness themeMode="system" onChange={() => {}} />)

    openThemeMenu()

    const options = screen.getAllByRole('menuitemradio')
    expect(options).toHaveLength(3)
    expect(options.map(option => option.textContent)).toEqual(['Light', 'Dark', 'Follow system'])
    expect(options.find(option => option.textContent === 'Follow system')?.getAttribute('aria-checked')).toBe('true')
    expect(options.find(option => option.textContent === 'Dark')?.getAttribute('aria-checked')).toBe('false')
  })

  it('点哪项上报哪项，偏好与菜单勾选跟着走', () => {
    const onChange = vi.fn()
    render(<ThemeMenuHarness themeMode="light" onChange={onChange} />)

    openThemeMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(onChange).toHaveBeenCalledWith('dark')

    // 选中即关闭菜单（Radix 默认），选「跟随系统」要重新打开。
    openThemeMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Follow system' }))
    expect(onChange).toHaveBeenCalledWith('system')
  })

  it('触发器把调用方的 children 原样摆进按钮（折叠态显隐由调用方管）', () => {
    render(<ThemeMenuHarness themeMode="dark" onChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'Theme mode' }).textContent).toContain('当前模式')
  })
})
