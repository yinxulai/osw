// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ProviderWebsiteLink } from './provider-website-link'

/*
 * 内置厂商官网外链。
 *
 * 两条容易写错的边界：显示的是**域名**（协议头与 `www.` 都不给用户信息），
 * 而 `openExternal` 收到的必须是**原始 url**（去掉 `www.` 的展示串不是合法跳转目标）；
 * 解析失败时退回原串，别把链接整个吞掉。
 */

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const caps = vi.hoisted(() => ({ value: null as null | { openExternal: (url: string) => void } }))
vi.mock('@/platform/capabilities', () => ({ getPlatformCapabilities: () => caps.value }))

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
  caps.value = { openExternal: vi.fn() }
})

describe('ProviderWebsiteLink', () => {
  it('没有官网时整块不渲染（自建供应商不编一个假地址）', () => {
    const { container } = render(<ProviderWebsiteLink url={undefined} />, { wrapper })
    expect(container.firstChild).toBeNull()
  })

  it('空串同样不渲染', () => {
    const { container } = render(<ProviderWebsiteLink url="" />, { wrapper })
    expect(container.firstChild).toBeNull()
  })

  it('只显示域名，去掉协议头与 www. 前缀', () => {
    render(<ProviderWebsiteLink url="https://www.anthropic.com" />, { wrapper })

    expect(screen.getByRole('button').textContent).toBe('anthropic.com')
  })

  it('title 与 aria-label 都是「用浏览器打开 <域名>」', () => {
    render(<ProviderWebsiteLink url="https://api.deepseek.com/v1" />, { wrapper })

    const button = screen.getByRole('button')
    expect(button.getAttribute('title')).toBe('用浏览器打开 api.deepseek.com')
    expect(button.getAttribute('aria-label')).toBe('用浏览器打开 api.deepseek.com')
  })

  it('点击时交给平台层打开的是原始 url，不是展示用的域名', () => {
    render(<ProviderWebsiteLink url="https://www.anthropic.com" />, { wrapper })

    fireEvent.click(screen.getByRole('button'))

    expect(caps.value?.openExternal).toHaveBeenCalledWith('https://www.anthropic.com')
  })

  it('url 解析失败时退回原串展示，仍然可点', () => {
    render(<ProviderWebsiteLink url="anthropic.com" />, { wrapper })

    const button = screen.getByRole('button')
    expect(button.textContent).toBe('anthropic.com')
    expect(button.getAttribute('aria-label')).toBe('用浏览器打开 anthropic.com')

    fireEvent.click(button)
    expect(caps.value?.openExternal).toHaveBeenCalledWith('anthropic.com')
  })

  it('外链图标对读屏隐藏（按钮的可访问名是那句 aria-label）', () => {
    const { container } = render(<ProviderWebsiteLink url="https://openai.com" />, { wrapper })

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('外部类名可以追加到按钮上', () => {
    render(<ProviderWebsiteLink url="https://openai.com" className="mt-1" />, { wrapper })

    expect(screen.getByRole('button').className).toContain('mt-1')
  })
})
