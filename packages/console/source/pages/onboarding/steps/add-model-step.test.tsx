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
    dialogProvider: null,
    selectDialogProvider: () => {},
    openPresetDialog: () => {},
    openProviderDialog: async () => {},
    openModelDialog: () => {},
  }),
}))

vi.mock('@/pages/model-management/components/provider-dialog', () => ({ ProviderDialog: () => null }))
vi.mock('@/pages/model-management/components/model-dialog', () => ({ ModelDialog: () => null }))

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

  it('一个供应商都没有时：摊成一张预设卡片墙（含首位「自定义供应商」），没有并列的顶层按钮', () => {
    render(<AddModelStep />, { wrapper: Wrapper })

    expect(screen.getByText(en('onboarding.models.empty'))).not.toBeNull()
    // 起点是整面卡片墙：第一张是「自定义供应商」，其余是内置预设，都在页面上直接可点。
    expect(screen.getByRole('button', { name: en('onboarding.models.customProvider') })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'OpenAI' })).not.toBeNull()
    // 空状态没有「已接入」列表，也不该再摆一颗孤立的「添加模型」。
    expect(screen.queryByRole('button', { name: en('onboarding.models.addModel') })).toBeNull()
  })

  it('每个供应商行尾就地给出「添加模型」：模型加给哪一家写在脸上', () => {
    providers.current = [{ id: 'prov_1', name: 'Example' }]
    render(<AddModelStep />, { wrapper: Wrapper })

    expect(screen.getByText('Example')).not.toBeNull()
    expect(screen.getByText(en('onboarding.models.modelCount', { count: 0 }))).not.toBeNull()
    // 归属由按钮所在的那一行表达，而不是靠一个隐式的「当前供应商」。
    expect(screen.getByRole('button', { name: en('onboarding.models.addModel') })).not.toBeNull()
  })

  it('模型接进来之后行尾的数量跟着更新', () => {
    providers.current = [{ id: 'prov_1', name: 'Example' }]
    models.current = [{ providerId: 'prov_1' }, { providerId: 'prov_1' }]
    render(<AddModelStep />, { wrapper: Wrapper })

    expect(screen.getByText(en('onboarding.models.modelCount', { count: 2 }))).not.toBeNull()
  })
})
