// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@common/schemas'

import type { ProviderPreset } from '../lib/provider-presets'
import { useProviderDialog } from './use-provider-dialog'

// `vi.mock` 的工厂会被提升到文件顶部，所以共享状态和桩数据都得从这里出去。
const { reported, createdProvider } = vi.hoisted(() => ({
  reported: [] as unknown[],
  createdProvider: { id: 'prov_new', name: 'Example', timeoutMilliseconds: 30000 },
}))

vi.mock('@/api/runtime', () => ({
  telemetryApi: { report: (event: unknown) => { reported.push(event) } },
}))

vi.mock('@/api/providers', () => ({
  providerApi: {
    create: async () => ({ success: true, data: createdProvider }),
    update: async () => ({ success: true, data: createdProvider }),
    endpoints: async () => ({
      success: true,
      data: [{ protocol: 'openai-completions', url: 'https://example.com/v1', enabled: true }],
    }),
  },
}))

// `useToast` 会拉一整套 Provider 树，这里只关心它别把测试拖进 UI。
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: () => {}, error: () => {} }),
}))

// 文案不是被测对象，回落到 key 本身即可。
vi.mock('@/i18n/provider', () => ({ useTranslation: () => (key: string) => key }))

// 真实 `useMutation` 需要 `QueryClientProvider`；这里把它压成「立刻执行」的壳，
// 好在不搭 react-query 环境的前提下也能走到 `onSuccess` 那条分支。
interface MutationOptions {
  mutationFn: () => Promise<Provider>
  onSuccess: (provider: Provider) => Promise<void>
  onError: (error: Error) => void
}

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutateAsync: async () => {
      try {
        const provider = await options.mutationFn()
        await options.onSuccess(provider)
        return provider
      } catch (error) {
        options.onError(error as Error)
        throw error
      }
    },
  }),
}))

const preset = {
  key: 'example',
  name: 'Example',
  color: '#000000',
  endpoints: { 'openai-completions': 'https://api.example.com/v1' },
} as unknown as ProviderPreset

const asProvider = createdProvider as unknown as Provider

function setup() {
  return renderHook(() => useProviderDialog({ reload: async () => {}, selectProvider: () => {} }))
}

afterEach(() => { reported.length = 0 })

describe('provider_created reporting', () => {
  it('reports kind=builtin when the dialog started from a preset', async () => {
    const view = setup()
    act(() => { view.result.current.openPresetDialog(preset) })
    await act(async () => { await view.result.current.saveProvider() })

    expect(reported).toEqual([{ name: 'provider_created', kind: 'builtin' }])
  })

  it('reports kind=custom when the dialog started empty', async () => {
    const view = setup()
    await act(async () => { await view.result.current.openProviderDialog() })
    act(() => { view.result.current.setProviderName('Example') })
    await act(async () => { await view.result.current.saveProvider() })

    expect(reported).toEqual([{ name: 'provider_created', kind: 'custom' }])
  })

  it('does not report when an existing provider is edited', async () => {
    const view = setup()
    await act(async () => { await view.result.current.openProviderDialog(asProvider) })
    await act(async () => { await view.result.current.saveProvider() })

    expect(reported).toEqual([])
  })
})
