// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { ROUTE_MODE_OPTIONS } from '@/components/route-mode/route-mode-options'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TraitsDisclosure } from './traits-disclosure'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

/** 与组件同源取词：断言的是「目录里那几句话真的出现在界面上」，而不是抄一遍文案。 */
const en = createAppTranslator('en')

/** 两个模式的差异点文案，用来断言「展开后逐条都在」。 */
const TRAIT_TEXTS = ROUTE_MODE_OPTIONS.flatMap(option => [...option.traitKeys].map(key => en(key)))

describe('TraitsDisclosure', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('默认收起：六行差异不上首屏，用户还没到要比较的时候', () => {
    render(<TraitsDisclosure />, { wrapper: Wrapper })

    expect(screen.getByRole('button', { name: en('onboarding.step.routeMode.traits.expand') })).not.toBeNull()
    // 「收起」在这里的含义是不渲染，而不是渲染一个更矮的版本。
    for (const text of TRAIT_TEXTS) expect(screen.queryByText(text)).toBeNull()
  })

  it('点开后两个模式的差异点并排摆出，逐条都在', () => {
    render(<TraitsDisclosure />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: en('onboarding.step.routeMode.traits.expand') }))

    // 并排是为了读得出对应关系：两栏各自带上自己的模式名，六行逐条都在（与弹窗同一份文案）。
    for (const option of ROUTE_MODE_OPTIONS) {
      expect(screen.getByText(en(option.labelKey))).not.toBeNull()
      for (const key of option.traitKeys) expect(screen.getByText(en(key))).not.toBeNull()
    }

    // 展开态换成「收起」，否则这颗按钮读起来像是还能再展开一次。
    expect(screen.getByRole('button', { name: en('onboarding.step.routeMode.traits.collapse') })).not.toBeNull()
  })
})
