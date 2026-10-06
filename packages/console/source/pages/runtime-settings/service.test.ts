// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRuntimeSettingsService } from './service'
import { useDevelopmentSeed } from './hooks/use-development-seed'
import { useRuntimeDataReload } from './hooks/use-runtime-data-reload'

/*
 * 运行时设置页的组合层。
 *
 * 这里有两处**跨 hook 的连线**，单看子 hook 的测试都盖不到：
 *   - `reload` 直接透传给页面（数据维护卡片上的按钮用的就是它）；
 *   - 「造种子数据」拿到的是同**一个** reload 函数——造完数据要立刻刷新，否则页面显示的还是旧值。
 */

const hooks = vi.hoisted(() => ({
  form: {
    settings: { requestLogRetentionDays: 7 },
    proxyStatus: { running: true },
    loading: false,
    saving: false,
    saved: true,
    isDirty: false,
    updateField: vi.fn(),
    resetSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
  reload: vi.fn(),
  pruneLogs: vi.fn(),
  seedDevelopmentData: vi.fn(),
  exportScreenshots: vi.fn(),
}))

vi.mock('./hooks/use-settings-form', () => ({ useSettingsForm: () => hooks.form }))
vi.mock('./hooks/use-request-log-retention', () => ({ useRequestLogRetention: () => ({ pruneLogs: hooks.pruneLogs }) }))
vi.mock('./hooks/use-runtime-data-reload', () => ({ useRuntimeDataReload: vi.fn(() => hooks.reload) }))
vi.mock('./hooks/use-development-seed', () => ({
  // 用 vi.fn 包一层：下面要断言「reload 被交给了造种子数据的那个 hook」。
  useDevelopmentSeed: vi.fn((reload: () => Promise<void>) => {
    hooks.developmentSeedArgs.push(reload)
    return { seedDevelopmentData: hooks.seedDevelopmentData }
  }),
}))
vi.mock('./hooks/use-screenshot-export', () => ({
  useScreenshotExport: () => ({ exportScreenshots: hooks.exportScreenshots, exporting: true, progress: { current: 2, total: 5 } }),
}))
vi.mock('./hooks/use-storage-usage', () => ({ useStorageUsage: () => 1024 }))

hooks.developmentSeedArgs = [] as Array<() => Promise<void>>

describe('useRuntimeSettingsService', () => {
  it('把表单状态按页面现有契约摊平（字段名就是页面用的名字）', () => {
    const { result } = renderHook(() => useRuntimeSettingsService())

    expect(result.current.settings).toBe(hooks.form.settings)
    expect(result.current.proxyStatus).toBe(hooks.form.proxyStatus)
    expect(result.current.loading).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(result.current.saved).toBe(true)
    expect(result.current.isDirty).toBe(false)
    expect(result.current.updateField).toBe(hooks.form.updateField)
    expect(result.current.resetSettings).toBe(hooks.form.resetSettings)
    expect(result.current.saveSettings).toBe(hooks.form.saveSettings)
  })

  it('reload 用同一个函数引用往外给（依赖它的按钮不该每次渲染都换回调）', () => {
    const { result } = renderHook(() => useRuntimeSettingsService())

    expect(result.current.reload).toBe(hooks.reload)
  })

  it('造种子数据拿到的是同一个 reload（造完立刻刷新，页面不会停在旧值）', () => {
    hooks.developmentSeedArgs.length = 0

    renderHook(() => useRuntimeSettingsService())

    expect(hooks.developmentSeedArgs).toEqual([hooks.reload])
  })

  it('清理日志、导出截图、存储占用各自透传', () => {
    const { result } = renderHook(() => useRuntimeSettingsService())

    expect(result.current.pruneLogs).toBe(hooks.pruneLogs)
    expect(result.current.exportScreenshots).toBe(hooks.exportScreenshots)
    expect(result.current.exportingScreenshots).toBe(true)
    expect(result.current.screenshotExportProgress).toEqual({ current: 2, total: 5 })
    expect(result.current.seedDevelopmentData).toBe(hooks.seedDevelopmentData)
    expect(result.current.storageBytes).toBe(1024)
  })

  it('确认依赖的 hook 都被调用了（漏掉一个就是页面上少一块）', () => {
    renderHook(() => useRuntimeSettingsService())

    expect(vi.mocked(useRuntimeDataReload)).toHaveBeenCalled()
    expect(vi.mocked(useDevelopmentSeed)).toHaveBeenCalled()
  })
})
