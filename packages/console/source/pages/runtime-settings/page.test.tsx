// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { createAppTranslator } from '@common/i18n/catalogs'
import { normalizeLocale, type Locale } from '@common/i18n'
import { SettingsSchema, type Settings } from '@common/schemas'
import { PageBreadcrumbsProvider } from '@/components/breadcrumbs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { createQueryFixture } from '@/test-support'
import { useAppUiStore } from '@/store/app-ui-store'
import { getHistory } from '@/routing/history'
import { routePaths } from '@/routing/routes'
import { isThemeParam, parseOverrides, type ThemeParam } from '@/routing/url-overrides'
import { RuntimeSettingsPage } from './page'
import { useRuntimeSettingsUiStore } from './store'

/*
 * 设置页语言控件的两条契约：
 *
 *  1. 下拉回显的是偏好本身。「跟随系统」必须能停在选中态，不能被解析后的具体语种盖掉。
 *  2. 重置不只要把草稿退回基线。语言预览写在 `?lang=` 里，并且优先于已保存的偏好；
 *     重置之后界面语言得回到已保存的设置，否则保存按钮已经不脏、预览却撤不回来。
 *
 * 地址栏在偏好为 `system` 时写成具体语种，是 `useAppearance` 写明的行为，这里不改它。
 */

const en = createAppTranslator('en')
const zh = createAppTranslator('zh-CN')

const state = vi.hoisted(() => ({
  settings: null as Settings | null,
}))

vi.mock('@/components/ui/toast', () => {
  const noop = vi.fn()
  const value = { toast: noop, success: noop, error: noop, info: noop, warning: noop }
  return { useToast: () => value }
})

const confirm = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/components/ui/confirm-dialog', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/ui/confirm-dialog')>()),
  useConfirm: () => confirm,
}))

vi.mock('@/data/settings', () => ({
  settingsKeys: { all: ['settings'] as const },
  useSettings: () => state.settings,
  useSettingsLoading: () => false,
  useSettingsError: () => null,
  useSettingsActions: () => ({ refresh: () => undefined }),
}))

vi.mock('@/data/proxy', () => ({
  proxyKeys: { status: ['proxy-status'] as const },
  useProxyStatus: () => ({ host: '127.0.0.1', port: 19300, running: false }),
  useProxyActions: () => ({ restart: async () => ({ success: true, errorMessage: '' }) }),
}))

// 占用读数会打到管理接口。这一页的语言行为与它无关，别让一个失败的请求把用例拖进重试。
vi.mock('./hooks/use-storage-usage', () => ({
  useStorageUsage: () => null,
  storageKeys: { usage: ['storage-usage'] as const },
}))

// 这两张卡一挂上就会请求远端（云同步状态、GitHub 贡献者）。语言下拉不经过它们。
vi.mock('./components/cloud-sync-card', () => ({ CloudSyncCard: () => null }))
vi.mock('./components/developer-card', () => ({ DeveloperCard: () => null }))

interface ShellSearch {
  lang?: Locale
  theme?: ThemeParam
}

function SettingsRoute() {
  return (
    <PageBreadcrumbsProvider>
      <RuntimeSettingsPage />
    </PageBreadcrumbsProvider>
  )
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  validateSearch: (search: Record<string, unknown>): ShellSearch => ({
    lang: normalizeLocale(typeof search.lang === 'string' ? search.lang : null) ?? undefined,
    theme: isThemeParam(search.theme) ? search.theme : undefined,
  }),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: routePaths.runtimeSettings,
  component: SettingsRoute,
})

const router = createRouter({
  routeTree: rootRoute.addChildren([settingsRoute]),
  history: getHistory(),
  defaultNotFoundComponent: () => <p>missing-route</p>,
})

function savedSettings(language: Settings['language']): Settings {
  return SettingsSchema.parse({ id: 'singleton', updatedTime: 0, language })
}

function renderPage() {
  const { wrapper } = createQueryFixture()
  return render(
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>,
    { wrapper },
  )
}

/** 触发器上正在显示的那一项。选项列表收着的时候不在 DOM 里，所以这就是受控值。 */
function selectedLabel(ariaLabel: string): string {
  const trigger = screen.getByLabelText(ariaLabel)
  return trigger.querySelector('[data-slot="select-value"]')?.textContent ?? trigger.textContent ?? ''
}

describe('settings language', () => {
  beforeAll(async () => {
    // 只导航这一次。路由在挂上又卸下之后再 `navigate` 会停住不返回；
    // 每个用例要的地址栏用 `replace` 直接写 history，路由在挂载时读到的就是它。
    await router.navigate({
      to: routePaths.runtimeSettings,
      search: { lang: 'en', theme: 'system' },
      replace: true,
    })
  })

  beforeEach(() => {
    state.settings = null
    confirm.mockClear()
    useRuntimeSettingsUiStore.setState({ draft: null, baseline: null, saved: false, isDirty: false })
    useLanguageStore.setState({ preference: 'system' })
    useAppUiStore.setState({ themeMode: 'system' })
    getHistory().replace(`${routePaths.runtimeSettings}?lang=en&theme=system`)
  })

  it('keeps Follow system selected when that preference is saved', async () => {
    state.settings = savedSettings('system')
    renderPage()

    const languageAria = en('settings.appearance.languageAria')
    const themeAria = en('settings.appearance.themeAria')
    await screen.findByLabelText(languageAria)

    // 地址栏里仍然是解析出来的具体语种。下拉不该跟着它走。
    expect(parseOverrides(getHistory().location.href).lang).toBe('en')
    expect(selectedLabel(languageAria)).toBe(en('settings.appearance.language.system'))
    expect(selectedLabel(themeAria)).toBe(en('settings.appearance.theme.system'))
  })

  it('returns the interface to the saved language when reset discards a preview', async () => {
    state.settings = savedSettings('zh-CN')
    renderPage()

    const languageAria = en('settings.appearance.languageAria')
    await screen.findByLabelText(languageAria)

    // 模拟「已经从简体中文切到 English」：草稿、本地偏好、地址栏三处都是预览值。
    act(() => {
      useRuntimeSettingsUiStore.getState().updateField('language', 'en')
      useLanguageStore.getState().setPreference('en')
    })

    const reset = screen.getByRole('button', { name: en('settings.action.reset') }) as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    expect(parseOverrides(getHistory().location.href).lang).toBe('en')
    expect(selectedLabel(languageAria)).toBe('English')

    fireEvent.click(reset)

    await waitFor(() => {
      expect(parseOverrides(getHistory().location.href).lang).toBe('zh-CN')
      expect(document.documentElement.lang).toBe('zh-CN')
    })
    expect(useLanguageStore.getState().preference).toBe('zh-CN')
    expect(useRuntimeSettingsUiStore.getState().draft?.language).toBe('zh-CN')
    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
    expect(selectedLabel(zh('settings.appearance.languageAria'))).toBe('简体中文')
    const resetAfter = screen.getByRole('button', { name: zh('settings.action.reset') }) as HTMLButtonElement
    expect(resetAfter.disabled).toBe(true)
  })
})
