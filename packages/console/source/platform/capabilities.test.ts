// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlatformCapabilities } from './capabilities'

/**
 * 能力探测的结果在模块级被缓存（`cached`），所以每种形态都必须重新加载模块才能验到——
 * 这也正是它该做的事：形态在应用生命周期内不会变，探测只做一次。
 */
async function load(): Promise<PlatformCapabilities> {
  vi.resetModules()
  const module = await import('./capabilities')
  return module.getPlatformCapabilities()
}

function setElectronApi(api: Partial<NonNullable<Window['electronAPI']>> | undefined): void {
  if (api === undefined) {
    delete (window as { electronAPI?: unknown }).electronAPI
    return
  }
  Object.defineProperty(window, 'electronAPI', { value: api, configurable: true, writable: true })
}

function setBrowserOs(platform: string, userAgent: string): void {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
}

afterEach(() => {
  setElectronApi(undefined)
})

describe('getPlatformCapabilities（浏览器形态）', () => {
  it('没有 electronAPI 时是 web，一切宿主能力都缺席而不是抛错', async () => {
    setElectronApi(undefined)
    const caps = await load()
    expect(caps.name).toBe('web')
    expect(caps.updater).toBeNull()
    expect(caps.screenshotExport).toBeNull()
    expect(caps.setTheme).toBeNull()
    expect(caps.onFullScreenChanged).toBeNull()
    expect(caps.getFullScreenState).toBeNull()
    // 「打开数据目录」在浏览器里没有意义：目录不在这台机器上。
    expect(caps.openDataDirectory).toBeNull()
  })

  // `openExternal` 是两种形态都必须有的：它没有可空类型，界面按「一直可用」写。
  it('打开外链走 window.open', async () => {
    setElectronApi(undefined)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const caps = await load()
    caps.openExternal('https://example.com')
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it.each([
    ['MacIntel', 'Mozilla/5.0 (Macintosh)', 'darwin'],
    ['Win32', 'Mozilla/5.0 (Windows NT 10.0)', 'win32'],
    ['Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['', 'Mozilla/5.0 (Unknown)', 'unknown'],
  ])('浏览器形态按 UA 猜操作系统：%s → %s', async (platform, userAgent, expected) => {
    setElectronApi(undefined)
    setBrowserOs(platform, userAgent)
    expect((await load()).os).toBe(expected)
  })
})

describe('getPlatformCapabilities（Electron 形态）', () => {
  it('认得出的 platform 直接映射成操作系统', async () => {
    setElectronApi({ platform: 'darwin', openExternal: vi.fn(), openDataDirectory: vi.fn() })
    const caps = await load()
    expect(caps.name).toBe('electron')
    expect(caps.os).toBe('darwin')
  })

  it('platform 认不出时是 unknown，而不是猜一个', async () => {
    setElectronApi({ platform: 'freebsd', openExternal: vi.fn(), openDataDirectory: vi.fn() })
    expect((await load()).os).toBe('unknown')
  })

  // preload 与渲染层是两份产物，版本能对不上：缺哪个能力就让哪个是 null，
  // 而不是整块能力对象崩掉、界面白屏。
  it('老版本 preload 没暴露的可选能力退化成 null', async () => {
    setElectronApi({ platform: 'win32', openExternal: vi.fn(), openDataDirectory: vi.fn() })
    const caps = await load()
    expect(caps.updater).toBeNull()
    expect(caps.screenshotExport).toBeNull()
    expect(caps.setTheme).toBeNull()
    expect(caps.onFullScreenChanged).toBeNull()
    expect(caps.getFullScreenState).toBeNull()
  })

  it('暴露了的能力被原样转发给宿主', async () => {
    const setTheme = vi.fn()
    const openExternal = vi.fn()
    const openDataDirectory = vi.fn(async () => {})
    const getFullScreenState = vi.fn(async () => true)
    const unsubscribe = vi.fn()
    const onFullScreenChanged = vi.fn(() => unsubscribe)
    const updater = { check: vi.fn() } as unknown as NonNullable<Window['electronAPI']>['updater']
    const screenshots = { exportAll: vi.fn(), onProgress: vi.fn() } as unknown as NonNullable<
      Window['electronAPI']
    >['screenshots']

    setElectronApi({ platform: 'win32', openExternal, openDataDirectory, setTheme, getFullScreenState, onFullScreenChanged, updater, screenshots })
    const caps = await load()

    expect(caps.updater).toBe(updater)
    expect(caps.screenshotExport).toBe(screenshots)

    caps.setTheme?.('dark')
    expect(setTheme).toHaveBeenCalledWith('dark')

    caps.openExternal('https://example.com')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')

    await caps.openDataDirectory?.()
    expect(openDataDirectory).toHaveBeenCalled()

    await expect(caps.getFullScreenState?.()).resolves.toBe(true)

    const listener = vi.fn()
    expect(caps.onFullScreenChanged?.(listener)).toBe(unsubscribe)
    expect(onFullScreenChanged).toHaveBeenCalledWith(listener)
  })

  // 探测只做一次：形态是进程级的，每次渲染都重扫一遍没有意义。
  it('同一形态下复用同一个结果', async () => {
    setElectronApi({ platform: 'linux', openExternal: vi.fn(), openDataDirectory: vi.fn() })
    vi.resetModules()
    const module = await import('./capabilities')
    expect(module.getPlatformCapabilities()).toBe(module.getPlatformCapabilities())
  })
})
