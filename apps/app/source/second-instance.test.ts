import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * `second-instance` 没有单独导出，行为在 `index.ts` 启动时就绑到 Electron 上。
 * 这里把 electron 桩成 darwin，把服务进程换成空实现，让真实的 `index.ts` 和
 * `TrayManager` 跑完启动，再走「关到托盘 → 第二个实例」。
 *
 * 断言的是调用顺序，不是 Dock 的像素：`dock.hide()` 把进程收成 UI element 之后，
 * 只 `BrowserWindow.show()` 不会把图标变回来，必须先 `dock.show()`。真机上图标
 * 是否回到 Dock / Cmd-Tab，仍要在 macOS 上看一眼。
 */
const mocks = vi.hoisted(() => {
  const appListeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const windows: FakeWindow[] = []
  let appReady = false
  let releaseReady: () => void = () => undefined
  const ready = new Promise<void>(resolve => {
    releaseReady = () => {
      appReady = true
      resolve()
    }
  })

  class FakeWindow {
    minimized = false
    visible = true
    destroyed = false
    listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    webContents = {
      once: vi.fn(),
      on: vi.fn(),
      openDevTools: vi.fn(),
      send: vi.fn(),
    }
    show = vi.fn(() => {
      this.visible = true
    })
    hide = vi.fn(() => {
      this.visible = false
    })
    focus = vi.fn()
    restore = vi.fn(() => {
      this.minimized = false
      this.visible = true
    })
    isMinimized = vi.fn(() => this.minimized)
    isVisible = vi.fn(() => this.visible)
    isDestroyed = vi.fn(() => this.destroyed)
    isFullScreen = vi.fn(() => false)
    setMenuBarVisibility = vi.fn()
    setBackgroundColor = vi.fn()
    setTitleBarOverlay = vi.fn()
    setAlwaysOnTop = vi.fn()
    loadURL = vi.fn(() => Promise.resolve())
    loadFile = vi.fn(() => Promise.resolve())
    on(event: string, listener: (...args: unknown[]) => void): void {
      const existing = this.listeners.get(event) ?? []
      existing.push(listener)
      this.listeners.set(event, existing)
    }

    constructor() {
      windows.push(this)
    }
  }

  const dock = {
    show: vi.fn(() => Promise.resolve()),
    hide: vi.fn(),
  }
  const app = {
    setName: vi.fn(),
    setPath: vi.fn(),
    getPath: vi.fn(() => '/tmp/osw-second-instance-test'),
    getName: vi.fn(() => 'OSW'),
    getVersion: vi.fn(() => '1.3.0'),
    getLocale: vi.fn(() => 'en-US'),
    isReady: vi.fn(() => appReady),
    isPackaged: false,
    requestSingleInstanceLock: vi.fn(() => true),
    setAboutPanelOptions: vi.fn(),
    setLoginItemSettings: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    dock,
    whenReady: vi.fn(() => ready),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const existing = appListeners.get(event) ?? []
      existing.push(listener)
      appListeners.set(event, existing)
    }),
  }
  const image = () => ({
    isEmpty: () => false,
    addRepresentation: vi.fn(),
    setTemplateImage: vi.fn(),
  })

  return {
    appListeners,
    windows,
    dock,
    app,
    releaseReady: () => releaseReady(),
    FakeWindow,
    image,
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: Object.assign(mocks.FakeWindow, {
    getAllWindows: () => mocks.windows.filter(window => !window.destroyed),
    fromWebContents: () => null,
  }),
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  },
  nativeImage: { createFromDataURL: vi.fn(() => mocks.image()) },
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system', on: vi.fn() },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  dialog: { showErrorBox: vi.fn() },
  session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } },
  Tray: vi.fn(function Tray() {
    return {
      setToolTip: vi.fn(),
      setTitle: vi.fn(),
      setContextMenu: vi.fn(),
      popUpContextMenu: vi.fn(),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 24, height: 24 })),
      destroy: vi.fn(),
      on: vi.fn(),
    }
  }),
  clipboard: { writeText: vi.fn() },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })),
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 12 })),
    on: vi.fn(),
    off: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
  },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}))

vi.mock('./server-host', () => ({
  startServer: vi.fn(async () => undefined),
  stopServer: vi.fn(async () => undefined),
  onServerStateChanged: vi.fn(),
  forwardRuntimeLog: vi.fn(),
  getProxyServerStatus: vi.fn(async () => ({ running: false, host: '127.0.0.1', port: 19300 })),
  getSettings: vi.fn(async () => ({
    language: 'system',
    autoLaunch: false,
    liveMetricMenuBarEnabled: false,
    liveMetricTemplate: '',
  })),
  onSettingsChanged: vi.fn(() => () => undefined),
  onLiveMetrics: vi.fn(() => () => undefined),
  startProxyServer: vi.fn(),
  stopProxyServer: vi.fn(),
}))

function emit(event: string, ...args: unknown[]): void {
  for (const listener of mocks.appListeners.get(event) ?? []) listener(...args)
}

describe('second-instance 恢复 Dock 图标', () => {
  beforeAll(async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    process.env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173/'
    await import('./index')
  })

  afterAll(async () => {
    emit('before-quit', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(mocks.app.quit).toHaveBeenCalled())
    delete process.env.VITE_DEV_SERVER_URL
    vi.restoreAllMocks()
  })

  it('关到托盘后再唤起时先 dock.show()，最小化时仍先 restore()', async () => {
    emit('second-instance')
    expect(mocks.dock.show).not.toHaveBeenCalled()
    expect(mocks.windows).toHaveLength(0)

    mocks.releaseReady()
    await vi.waitFor(() => {
      const closeListeners = mocks.windows[0]?.listeners.get('close')
      expect(closeListeners?.length ?? 0).toBeGreaterThan(0)
    })
    const main = mocks.windows[0]
    if (!main) throw new Error('main window was never created')

    main.minimized = true
    main.visible = false
    emit('second-instance')
    await vi.waitFor(() => expect(main.focus).toHaveBeenCalled())
    expect(main.restore).toHaveBeenCalledTimes(1)

    main.restore.mockClear()
    main.show.mockClear()
    main.focus.mockClear()
    main.hide.mockClear()
    mocks.dock.show.mockClear()
    mocks.dock.hide.mockClear()
    main.minimized = false
    main.visible = true

    const closeEvent = { preventDefault: vi.fn() }
    for (const listener of main.listeners.get('close') ?? []) listener(closeEvent)
    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(main.hide).toHaveBeenCalledTimes(1)
    expect(mocks.dock.hide).toHaveBeenCalledTimes(1)
    expect(main.show).not.toHaveBeenCalled()
    expect(main.isMinimized()).toBe(false)

    // `dock.show()` 在应用仍处于前台时会晚一拍才真正改进程类型。窗口必须等它完成，
    // 不能在调用发出去的同时 `show()`。
    let releaseDock = (): void => undefined
    mocks.dock.show.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseDock = resolve
        }),
    )
    emit('second-instance')
    await vi.waitFor(() => expect(mocks.dock.show).toHaveBeenCalledTimes(1))
    expect(main.show).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
    releaseDock()
    await vi.waitFor(() => expect(main.show).toHaveBeenCalledTimes(1))
    expect(main.focus).toHaveBeenCalledTimes(1)
    expect(main.restore).not.toHaveBeenCalled()
    expect(mocks.dock.show.mock.invocationCallOrder[0]).toBeLessThan(main.show.mock.invocationCallOrder[0])
    expect(main.show.mock.invocationCallOrder[0]).toBeLessThan(main.focus.mock.invocationCallOrder[0])

    mocks.dock.show.mockClear()
    main.show.mockClear()
    main.focus.mockClear()
    emit('activate')
    await vi.waitFor(() => expect(mocks.dock.show).toHaveBeenCalledTimes(1))
    expect(main.show).toHaveBeenCalledTimes(1)
    expect(main.focus).toHaveBeenCalledTimes(1)
  })
})
