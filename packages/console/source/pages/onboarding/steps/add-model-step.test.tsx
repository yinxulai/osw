// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { AddModelStep } from './add-model-step'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 这一步的正文是「列表如何给下一步」：供应商与模型的存在与否就是全部输入，
// 建立/拉取那一整套链路（两个对话框、拉取失败、重复模型）由模型管理页自己的测试守着。
const providers = vi.hoisted(() => ({ current: [] as { id: string; name: string }[] }))
const models = vi.hoisted(() => ({ current: [] as { providerId: string }[] }))

vi.mock('@/pages/model-management/hooks/use-model-management', () => ({
  useModelManagement: () => ({
    providers: providers.current,
    models: models.current,
    providerName: '',
    selectedProvider: providers.current[0] ?? null,
    openPresetDialog: () => {},
    openProviderDialog: async () => {},
    openModelDialog: () => {},
  }),
}))

vi.mock('@/pages/model-management/components/provider-dialog', () => ({ ProviderDialog: () => null }))
vi.mock('@/pages/model-management/components/model-dialog', () => ({ ModelDialog: () => null }))
vi.mock('@/pages/model-management/components/provider-preset-picker', () => ({
  ProviderPresetPicker: () => <div data-testid="preset-picker" />,
}))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const en = createAppTranslator('en')

describe('AddModelStep', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    providers.current = []
    models.current = []
  })

  it('一个供应商都没有时，就地说明该先做什么，而不是让按钮静默禁用', () => {
    render(<AddModelStep />, { wrapper: Wrapper })

    expect(screen.getByText(en('onboarding.models.empty'))).not.toBeNull()
    // 控件本身交代自己是干什么的，页头那句描述交代整条路径：这里不再叠第三段操作说明。
    expect(screen.getByTestId('preset-picker')).not.toBeNull()
    expect(screen.queryByText(en('onboarding.models.nextAddModel'))).toBeNull()
  })

  it('有供应商但还没有模型时，把「点添加模型去拉取」说在列表旁边', () => {
    providers.current = [{ id: 'prov_1', name: 'Example' }]
    render(<AddModelStep />, { wrapper: Wrapper })

    expect(screen.getByText('Example')).not.toBeNull()
    expect(screen.getByText(en('onboarding.models.modelCount', { count: 0 }))).not.toBeNull()
    // 用户真正会停下来的位置就是这里，所以话放在这里，而不是页面开头。
    expect(screen.getByText(en('onboarding.models.nextAddModel'))).not.toBeNull()
  })

  it('模型拉起来之后那句下一步就该退场，不留在列表里当噪音', () => {
    providers.current = [{ id: 'prov_1', name: 'Example' }]
    models.current = [{ providerId: 'prov_1' }, { providerId: 'prov_1' }]
    render(<AddModelStep />, { wrapper: Wrapper })

    expect(screen.getByText(en('onboarding.models.modelCount', { count: 2 }))).not.toBeNull()
    expect(screen.queryByText(en('onboarding.models.nextAddModel'))).toBeNull()
  })
})
