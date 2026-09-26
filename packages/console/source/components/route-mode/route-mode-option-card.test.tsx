// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RouteModeOptionCard } from './route-mode-option-card'
import { ROUTE_MODE_OPTIONS } from './route-mode-options'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const en = createAppTranslator('en')
const OPTION = ROUTE_MODE_OPTIONS[0]

function renderCard(compact?: boolean) {
  return render(
    <RouteModeOptionCard option={OPTION} active switching={false} compact={compact} onSelect={() => {}} />,
    { wrapper: Wrapper },
  )
}

describe('RouteModeOptionCard', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('默认形态摆出三条差异点：模式弹窗就是「看清楚再选」的地方', () => {
    renderCard()

    expect(screen.getByText(en(OPTION.labelKey))).not.toBeNull()
    expect(screen.getByText(en(OPTION.summaryKey))).not.toBeNull()
    for (const key of OPTION.traitKeys) expect(screen.getByText(en(key))).not.toBeNull()
  })

  it('compact 只留名字、一句话摘要与生效态，差异点不占引导页首屏', () => {
    const { container } = renderCard(true)

    expect(screen.getByText(en(OPTION.labelKey))).not.toBeNull()
    expect(screen.getByText(en(OPTION.summaryKey))).not.toBeNull()
    expect(screen.getByText(en('router.mode.active'))).not.toBeNull()
    // 差异点没有被删掉，只是换了地方（引导页收进折叠区）。卡片上的这三行不再渲染。
    for (const key of OPTION.traitKeys) expect(screen.queryByText(en(key))).toBeNull()
    // 仍是同一个可点、可键盘操作的单选栏，紧凑只改排版。
    expect(container.querySelector('input[type="radio"]')).not.toBeNull()
  })
})
