import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

/**
 * `host-ipc` 是主窗口与**无头补拍入口**共用的宿主 IPC 面。
 *
 * 它是被一个真实的 bug 逼出来的：`source/preload.ts` 用 `ipcRenderer.sendSync('runtime:get-config')`
 * 取管理服务基地址，而 `ipcMain` 那一侧没有监听者时，`sendSync` **不报错也不超时**——
 * 渲染进程主线程就此永久阻塞，现象是「截图脚本卡住不动」，只在控制台留一行
 * `... called ipcRenderer.sendSync() with 'runtime:get-config' channel without listeners.`。
 * 无头入口当时就是漏了注册这一面。
 *
 * 所以这里断言的不是「函数能跑」，而是**通道名与监听者真的挂上去了**：通道名写错一个字，
 * 渲染进程那边同样是静默阻塞，属于「静态检查全绿、线上必挂」的那一类。
 */
const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()

  return {
    listeners,
    handlers,
    ipcMain: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const existing = listeners.get(channel) ?? []
        existing.push(listener)
        listeners.set(channel, existing)
      }),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    },
    app: { getPath: vi.fn(() => '/tmp/osw-test-user-data') },
    shell: {
      openExternal: vi.fn<(url: string) => Promise<void>>(() => Promise.resolve()),
      openPath: vi.fn<(target: string) => Promise<string>>(() => Promise.resolve('')),
    },
    nativeTheme: {
      themeSource: 'system',
      shouldUseDarkColors: false,
      on: vi.fn(),
    },
    fromWebContents: vi.fn<(contents: unknown) => unknown>(() => null),
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell,
  nativeTheme: mocks.nativeTheme,
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}))

/** 窗口替身：只记下 `applyWindowChrome` 与全屏那两条链路会碰的方法。 */
function windowStub() {
  return {
    setBackgroundColor: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    on: vi.fn(),
    webContents: { send: vi.fn() },
  }
}

/**
 * 每个用例拿一份全新的模块实例。
 *
 * 模块级的「已注册」标记是**刻意的**设计（重复注册会静静盖掉前一个监听者），但它也让用例
 * 之间互相污染；`resetModules` 换一份干净实例是唯一干净的清法——正因如此，下面所有用例都
 * 用动态 `import()` 取函数，而不是文件顶层的 import（那份实例共享且无法重置）。
 */
function loadHostIpc() {
  return import('./host-ipc')
}

beforeEach(() => {
  vi.resetModules()
  mocks.listeners.clear()
  mocks.handlers.clear()
  mocks.ipcMain.on.mockClear()
  mocks.ipcMain.handle.mockClear()
  mocks.shell.openExternal.mockClear()
  mocks.shell.openPath.mockClear()
  mocks.app.getPath.mockClear()
  mocks.fromWebContents.mockReset()
  mocks.fromWebContents.mockReturnValue(null)
  mocks.nativeTheme.themeSource = 'system'
  mocks.nativeTheme.shouldUseDarkColors = false
})

/** 触发某个通道上注册过的**第一个**监听者，返回它的返回值。 */
function fire(channel: string, ...args: unknown[]): unknown {
  const listener = mocks.listeners.get(channel)?.[0]
  if (!listener) throw new Error(`no listener registered for ${channel}`)
  return listener(...args)
}

describe('registerRuntimeConfigIpc', () => {
  it('answers the synchronous runtime:get-config call the preload makes', async () => {
    const { registerRuntimeConfigIpc } = await loadHostIpc()
    registerRuntimeConfigIpc('http://127.0.0.1:19301/api')

    // `sendSync` 的调用方读的就是 `event.returnValue`；这里换成 `ipcMain.handle` 就不管用，
    // 渲染进程会一直等下去。
    const event = { returnValue: undefined as unknown }
    fire('runtime:get-config', event)

    expect(event.returnValue).toEqual({ apiBase: 'http://127.0.0.1:19301/api' })
    expect(mocks.handlers.has('runtime:get-config')).toBe(false)
  })

  it('stays idempotent so a second registration cannot silently replace the first', async () => {
    const { registerRuntimeConfigIpc } = await loadHostIpc()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    registerRuntimeConfigIpc('http://127.0.0.1:19301/api')
    registerRuntimeConfigIpc('http://127.0.0.1:9301/api')

    // 两条注册若都落下去，后一个监听者会盖掉前一个，行为就取决于调用顺序——那种差异
    // 只会在很怪的复现步骤里炸，所以宁可是「一条日志 + 跳过」。
    expect(mocks.listeners.get('runtime:get-config')).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('registerExternalLinkIpc', () => {
  it('opens https links and refuses anything else', async () => {
    const { registerExternalLinkIpc } = await loadHostIpc()
    registerExternalLinkIpc()

    fire('open-external', {}, 'https://github.com/yinxulai/osw')
    expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://github.com/yinxulai/osw')

    // 渲染进程送来的字符串不能直接进 `shell.openExternal`：`file:` 与自定义协议
    // 等于把「在本机执行动作」的能力交回给了页面。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fire('open-external', {}, 'file:///etc/passwd')
    fire('open-external', {}, 42)
    expect(mocks.shell.openExternal).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('registerOpenDataDirectoryIpc', () => {
  it('opens the host-resolved userData directory, never a path from the renderer', async () => {
    const { registerOpenDataDirectoryIpc } = await loadHostIpc()
    registerOpenDataDirectoryIpc()

    const handler = mocks.handlers.get('open-data-directory')
    expect(handler).toBeDefined()
    await handler?.()

    expect(mocks.app.getPath).toHaveBeenCalledWith('userData')
    expect(mocks.shell.openPath).toHaveBeenCalledWith('/tmp/osw-test-user-data')
  })

  it('rejects instead of reporting success when the shell cannot open the directory', async () => {
    const { registerOpenDataDirectoryIpc } = await loadHostIpc()
    mocks.shell.openPath.mockResolvedValueOnce('Unable to open the directory')
    registerOpenDataDirectoryIpc()

    // 吞掉失败的话，按钮看起来就是「点了没反应」。
    await expect(mocks.handlers.get('open-data-directory')?.()).rejects.toThrow(
      'Unable to open the directory',
    )
  })
})

describe('registerWindowThemeIpc', () => {
  it('keeps "system" verbatim so the renderer keeps following the OS', async () => {
    const { registerWindowThemeIpc } = await loadHostIpc()
    const target = windowStub()
    mocks.fromWebContents.mockReturnValue(target)

    registerWindowThemeIpc()
    fire('appearance:set-theme', {}, 'system')

    // 解析成具体亮暗会把「跟随系统」钉死在切换那一刻，之后系统怎么变都不再更新。
    expect(mocks.nativeTheme.themeSource).toBe('system')
    expect(target.setBackgroundColor).toHaveBeenCalled()
  })

  it('ignores values that are not a known theme mode', async () => {
    const { registerWindowThemeIpc } = await loadHostIpc()
    registerWindowThemeIpc()
    fire('appearance:set-theme', {}, 'solarized')
    expect(mocks.nativeTheme.themeSource).toBe('system')
  })
})

describe('registerWindowFullScreenEvents', () => {
  it('reports the registered window state and notifies on transitions', async () => {
    const { registerWindowFullScreenEvents, registerWindowFullScreenIpc } = await loadHostIpc()
    const target = windowStub()
    registerWindowFullScreenIpc()
    registerWindowFullScreenEvents(target as unknown as BrowserWindow)

    expect(mocks.handlers.get('window:get-full-screen-state')?.()).toBe(false)

    target.isFullScreen.mockReturnValue(true)
    const entered = target.on.mock.calls.find(call => call[0] === 'enter-full-screen')?.[1] as
      | (() => void)
      | undefined
    entered?.()
    expect(target.webContents.send).toHaveBeenCalledWith('window:full-screen-changed', true)
  })
})

describe('registerWindowFullScreenIpc', () => {
  it('reports false while no window is registered', async () => {
    const { registerWindowFullScreenIpc } = await loadHostIpc()
    registerWindowFullScreenIpc()

    // 无头补拍入口不登记窗口（截图窗口永远不是全屏），false 正是它该看到的答案。
    expect(mocks.handlers.get('window:get-full-screen-state')?.()).toBe(false)
  })
})

describe('applyWindowTheme', () => {
  it('recomputes the window chrome from shouldUseDarkColors, not from the requested mode', async () => {
    const { applyWindowTheme } = await loadHostIpc()
    const target = windowStub()

    mocks.nativeTheme.shouldUseDarkColors = true
    applyWindowTheme(target as unknown as BrowserWindow, 'light')

    // `shouldUseDarkColors` 在 `themeSource` 写入的瞬间就已同步成目标值，所以底色取它才对；
    // 按入参分支会在「跟随系统」时算错。
    expect(target.setBackgroundColor).toHaveBeenCalledWith('#0d0d0d')
  })
})

describe('applyWindowChrome', () => {
  it('sets the background everywhere and the overlay only off macOS', async () => {
    const { applyWindowChrome } = await loadHostIpc()
    const target = windowStub()

    applyWindowChrome(target as unknown as BrowserWindow)

    expect(target.setBackgroundColor).toHaveBeenCalledTimes(1)
    if (process.platform === 'darwin') {
      // macOS 的标题栏由系统绘制，没有 overlay 可设。
      expect(target.setTitleBarOverlay).not.toHaveBeenCalled()
    } else {
      // 高度必须与渲染层的 `WindowTitlebar`（`h-9`）一致。
      expect(target.setTitleBarOverlay).toHaveBeenCalledWith(expect.objectContaining({ height: 36 }))
    }
  })
})
