// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RoutePlanList } from './route-plan-list'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 这一步只是把「内置方案」摆出来给新手挑一套，落点在服务端草稿/版本那一侧，
// 与这张清单的排版无关。所以这里替掉取数与套用两侧，只验清单本身的读法。
const apply = vi.hoisted(() => vi.fn())
vi.mock('@/components/route-mode/use-route-mode', () => ({ useRouteMode: () => ({ mode: 'rules' }) }))
vi.mock('../hooks/use-route-plans', () => ({
  useRoutePlans: () => ({
    options: [
      { id: 'a', isDefault: true, nameKey: 'router.rules.preset.model-direct.name', descriptionKey: 'router.rules.preset.model-direct.description' },
      { id: 'b', isDefault: false, nameKey: 'router.rules.preset.client-source.name', descriptionKey: 'router.rules.preset.client-source.description' },
    ],
    builtInDefaultKey: 'router.rules.preset.builtInDefault',
    currentKey: 'router.rules.preset.current',
    activeId: 'b',
    applyingId: null,
    loading: false,
    apply,
  }),
}))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const en = createAppTranslator('en')

const NAME_A = 'router.rules.preset.model-direct.name'
const NAME_B = 'router.rules.preset.client-source.name'
const DESC_A = 'router.rules.preset.model-direct.description'
const DESC_B = 'router.rules.preset.client-source.description'

describe('RoutePlanList', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    apply.mockClear()
  })

  it('每行只留名字与标记：清单要回答的是「现在跑的是哪套、要不要换」', () => {
    render(<RoutePlanList />, { wrapper: Wrapper })

    expect(screen.getByText(en(NAME_A))).not.toBeNull()
    expect(screen.getByText(en(NAME_B))).not.toBeNull()
    expect(screen.getByText(en('router.rules.preset.builtInDefault'))).not.toBeNull()
    expect(screen.getByText(en('router.rules.preset.current'))).not.toBeNull()

    // 四段说明默认不摆：它们不是决定的一部分，一屏并列会先被读成「四个都得弄明白」。
    expect(screen.queryByText(en(DESC_A))).toBeNull()
    expect(screen.queryByText(en(DESC_B))).toBeNull()
  })

  it('点开说明后每套方案都被解释一遍，收起入口换成相反的措辞', () => {
    render(<RoutePlanList />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: en('onboarding.step.routeMode.plans.expand') }))

    expect(screen.getByText(en(DESC_A))).not.toBeNull()
    expect(screen.getByText(en(DESC_B))).not.toBeNull()
    expect(screen.getByRole('button', { name: en('onboarding.step.routeMode.plans.collapse') })).not.toBeNull()
  })

  it('点一行就套用那一套，并标出它现在生效', () => {
    render(<RoutePlanList />, { wrapper: Wrapper })

    // 用名字找行、再取它所在的那颗按钮：行上还挂着角标与「当前」标记，名字不是它的全部可访问名。
    fireEvent.click(screen.getByText(en(NAME_A)).closest('button') as HTMLButtonElement)

    expect(apply).toHaveBeenCalledWith('a')
    expect(screen.getByText(en(NAME_A)).closest('button')).toHaveProperty('ariaPressed', 'false')
    expect(screen.getByText(en(NAME_B)).closest('button')).toHaveProperty('ariaPressed', 'true')
  })
})
