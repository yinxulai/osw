// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppUiStore } from './app-ui-store'

/*
 * 本地 UI 偏好（主题模式 / 引导是否走完 / 侧栏是否钉住）。
 *
 * 这三项的共性是「这台机器上这个人怎么看这个界面」，所以全部存 localStorage 而不是服务端设置：
 * 换一台机器重新来一遍是对的。另外它们都只是**偏好**，不进地址栏、不参与路由。
 */

const STORAGE_KEY = 'osw-ui'

beforeEach(() => {
  window.localStorage.clear()
  useAppUiStore.setState({ themeMode: 'system', onboardingComplete: false, sidebarPinned: false })
})

describe('默认值', () => {
  it('主题默认跟随系统（不擅自替用户定死亮暗）', () => {
    expect(useAppUiStore.getState().themeMode).toBe('system')
  })

  it('没走完引导、侧栏默认不钉住', () => {
    expect(useAppUiStore.getState().onboardingComplete).toBe(false)
    expect(useAppUiStore.getState().sidebarPinned).toBe(false)
  })
})

describe('setter', () => {
  it('改主题模式', () => {
    useAppUiStore.getState().setThemeMode('dark')
    expect(useAppUiStore.getState().themeMode).toBe('dark')

    useAppUiStore.getState().setThemeMode('light')
    expect(useAppUiStore.getState().themeMode).toBe('light')
  })

  it('引导标记是可来回的（重新看一遍引导）', () => {
    useAppUiStore.getState().setOnboardingComplete(true)
    expect(useAppUiStore.getState().onboardingComplete).toBe(true)

    useAppUiStore.getState().setOnboardingComplete(false)
    expect(useAppUiStore.getState().onboardingComplete).toBe(false)
  })

  it('钉住侧栏', () => {
    useAppUiStore.getState().setSidebarPinned(true)
    expect(useAppUiStore.getState().sidebarPinned).toBe(true)
  })

  it('改一项不会顺手改动另外两项', () => {
    useAppUiStore.getState().setThemeMode('dark')
    expect(useAppUiStore.getState().onboardingComplete).toBe(false)
    expect(useAppUiStore.getState().sidebarPinned).toBe(false)
  })
})

describe('持久化', () => {
  it('三项都写进 localStorage，键名是 osw-ui', () => {
    useAppUiStore.getState().setThemeMode('dark')
    useAppUiStore.getState().setOnboardingComplete(true)
    useAppUiStore.getState().setSidebarPinned(true)

    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toEqual({
      state: { themeMode: 'dark', onboardingComplete: true, sidebarPinned: true },
      version: 0,
    })
  })

  it('只存这三项，函数不会被序列化进去', () => {
    useAppUiStore.getState().setThemeMode('light')

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) as string).state
    expect(Object.keys(persisted).sort()).toEqual(['onboardingComplete', 'sidebarPinned', 'themeMode'])
  })

  it('重新建一份实例时会读回上次写入的值（模拟刷新页面）', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { themeMode: 'dark', onboardingComplete: true, sidebarPinned: true },
      version: 0,
    }))
    vi.resetModules()

    const { useAppUiStore: fresh } = await import('./app-ui-store')

    expect(fresh.getState().themeMode).toBe('dark')
    expect(fresh.getState().onboardingComplete).toBe(true)
    expect(fresh.getState().sidebarPinned).toBe(true)
  })

  it('存档坏掉时不让整个应用崩：缺的字段回落到默认值', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')
    vi.resetModules()

    const { useAppUiStore: fresh } = await import('./app-ui-store')

    expect(fresh.getState().themeMode).toBe('system')
    expect(fresh.getState().sidebarPinned).toBe(false)
  })
})
