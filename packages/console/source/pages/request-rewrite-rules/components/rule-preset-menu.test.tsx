// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RULE_PRESETS } from '../rule-presets'
import { RulePresetMenu } from './rule-preset-menu'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

/** Radix 的菜单触发器在 `pointerdown` 或方向键上开菜单，jsdom 里走键盘更稳。 */
function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /New rule/ }), { key: 'ArrowDown' })
}

function menuItems() {
  return screen.getAllByRole('menuitem')
}

describe('RulePresetMenu', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('把浮层锚在触发器上，并列出空白规则与全部模板', async () => {
    render(<RulePresetMenu onCreateBlank={() => {}} onCreateFromPreset={() => {}} />, { wrapper: Wrapper })
    openMenu()

    // 模板 + 空白规则各占一项。
    await waitFor(() => expect(menuItems()).toHaveLength(RULE_PRESETS.length + 1))

    // 回归点：Radix 定位不到锚点时会一直保持未定位状态，把内容 `translate(0, -200%)` 挪出视口，
    // 用户看到的就是「点了没反应」。显式断言浮层没有停在这个状态。
    const popperWrapper = document.querySelector('[data-radix-popper-content-wrapper]') as HTMLElement
    expect(popperWrapper.style.transform).not.toBe('translate(0, -200%)')
  })

  it('选中模板时把对应预设交给调用方', async () => {
    const onCreateFromPreset = vi.fn()
    render(<RulePresetMenu onCreateBlank={() => {}} onCreateFromPreset={onCreateFromPreset} />, { wrapper: Wrapper })
    openMenu()

    await waitFor(() => expect(menuItems()).toHaveLength(RULE_PRESETS.length + 1))

    // 第 1 项是空白规则，第 2 项起与 `RULE_PRESETS` 同序。
    const target = menuItems()[1]
    target.focus()
    fireEvent.keyDown(target, { key: 'Enter' })

    expect(onCreateFromPreset).toHaveBeenCalledWith(RULE_PRESETS[0])
  })

  it('选中空白规则时走另一条回调', async () => {
    const onCreateBlank = vi.fn()
    render(<RulePresetMenu onCreateBlank={onCreateBlank} onCreateFromPreset={() => {}} />, { wrapper: Wrapper })
    openMenu()

    await waitFor(() => expect(menuItems()).toHaveLength(RULE_PRESETS.length + 1))

    const target = menuItems()[0]
    target.focus()
    fireEvent.keyDown(target, { key: 'Enter' })

    expect(onCreateBlank).toHaveBeenCalled()
  })
})
