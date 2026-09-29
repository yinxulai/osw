import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { createAppTranslator } from '@common/i18n/catalogs'

/**
 * 托盘是原生 UI，只能在主进程里跑，没有 DOM 可以断言。
 * 所以这里把 electron 与两个外部依赖打桩，直接验菜单内容与点击行为——
 * 这是托盘唯一能被自动化覆盖的部分（视觉效果仍需人工看）。
 *
 * 代理开关打的是 `./server-host` 的桩，而不是核心服务：那三个函数现在会跨进程
 * 发消息（见 `server-host.ts`），真去发只会变成「进程不存在」。
 */
const mocks = vi.hoisted(() => {
  const tray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    popUpContextMenu: vi.fn(),
    getBounds: vi.fn(() => ({ x: 500, y: 0, width: 24, height: 24 })),
    destroy: vi.fn(),
    on: vi.fn(),
  }
  const mainWindow = {
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
  }
  // `new Tray(...)` 要能被当成构造函数；返回对象即可替换掉实例。
  const Tray = vi.fn(function TrayMock() {
    return tray
  })

  /**
   * 托盘面板窗口的替身。
   *
   * 面板是「窗口」那一层的行为：尺寸由页面报上来，位置由托盘图标与工作区算出来。
   * 真正值得断言的就是这条链路，所以这个替身老老实实记录 `setBounds`。
   */
  const panelWindows: PanelWindowStub[] = []
  class PanelWindowStub {
    contentSize: [number, number]
    bounds: PanelBounds | null = null
    visible = false
    destroyed = false
    webContents = { on: vi.fn(), send: vi.fn() }
    loadFile = vi.fn(() => Promise.resolve())
    loadURL = vi.fn(() => Promise.resolve())
    setAlwaysOnTop = vi.fn()
    on = vi.fn()
    show = vi.fn(() => {
      this.visible = true
    })
    hide = vi.fn(() => {
      this.visible = false
    })
    focus = vi.fn()
    isVisible = vi.fn(() => this.visible)
    isDestroyed = vi.fn(() => this.destroyed)
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    getContentSize = vi.fn((): [number, number] => this.contentSize)
    setBounds = vi.fn((next: PanelBounds) => {
      this.bounds = next
      this.contentSize = [next.width, next.height]
    })

    constructor(_options: unknown) {
      this.contentSize = [422, 560]
      panelWindows.push(this)
    }
  }

  return {
    tray,
    mainWindow,
    Tray,
    panelWindows,
    PanelWindowStub,
    app: { quit: vi.fn(), dock: { show: vi.fn(), hide: vi.fn() } },
    clipboard: { writeText: vi.fn() },
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
    handle: vi.fn(),
    removeHandler: vi.fn(),
    onIpc: vi.fn(),
    offIpc: vi.fn(),
    screen: { getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })) },
    getProxyServerStatus: vi.fn(),
    startProxyServer: vi.fn(),
    stopProxyServer: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  Tray: mocks.Tray,
  BrowserWindow: mocks.PanelWindowStub,
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  clipboard: mocks.clipboard,
  ipcMain: {
    handle: mocks.handle,
    removeHandler: mocks.removeHandler,
    on: mocks.onIpc,
    off: mocks.offIpc,
    removeAllListeners: vi.fn(),
  },
  screen: mocks.screen,
}))

vi.mock('./tray-icon', () => ({ generateTrayIcon: () => ({}) }))

vi.mock('./i18n', () => ({
  nativeLocale: () => 'zh-CN',
  nativeTranslator: () => createAppTranslator('zh-CN'),
  onNativeLocaleChanged: () => () => undefined,
}))

vi.mock('./server-host', () => ({
  getProxyServerStatus: mocks.getProxyServerStatus,
  startProxyServer: mocks.startProxyServer,
  stopProxyServer: mocks.stopProxyServer,
}))

import { TrayManager } from './tray-manager'
import { TrayPanelManager, resolveTrayPanelPosition } from './tray-panel'

interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
}

type MenuItem = MenuItemConstructorOptions

/** 最近一次挂到托盘上的菜单模板。 */
function lastTemplate(): MenuItem[] {
  const call = mocks.buildFromTemplate.mock.calls.at(-1)
  if (!call) throw new Error('tray menu was never built')
  return call[0]
}

/** 只看有文案的条目：分隔线与 macOS 分组标题不参与顺序断言。 */
function labels(): (string | undefined)[] {
  return lastTemplate()
    .filter(item => item.type !== 'separator' && item.type !== 'header')
    .map(item => item.label)
}

function findItem(label: string): MenuItem {
  const item = lastTemplate().find(entry => entry.label === label)
  if (!item) throw new Error(`menu item not found: ${label}`)
  return item
}

function click(item: MenuItem): void {
  const handler = item.click as (() => void) | undefined
  if (!handler) throw new Error(`menu item is not clickable: ${String(item.label)}`)
  handler()
}

async function initRunning(): Promise<TrayManager> {
  const manager = new TrayManager()
  manager.init(mocks.mainWindow as unknown as BrowserWindow)
  await vi.waitFor(() => expect(mocks.buildFromTemplate).toHaveBeenCalled())
  return manager
}

/**
 * 一个状态会真的改变的假代理服务。
 *
 * 比按调用次数排队更接近真实行为：轮询、点击、点击后再读，同一份状态被读多次，
 * 「第几次返回什么」这种写法会把用例意图藏在调用顺序里。
 */
function fakeProxyServer(initialRunning: boolean): { isRunning: () => boolean } {
  let running = initialRunning
  mocks.getProxyServerStatus.mockImplementation(async () => ({
    running,
    host: '127.0.0.1',
    port: 19300,
  }))
  mocks.startProxyServer.mockImplementation(async () => {
    running = true
  })
  mocks.stopProxyServer.mockImplementation(async () => {
    running = false
  })
  return { isRunning: () => running }
}

let manager: TrayManager | null = null

afterEach(() => {
  manager?.destroy()
  manager = null
  vi.clearAllMocks()
})

describe('托盘面板窗口', () => {
  const OUTPUT_DIRECTORY = '/tmp/osw-panel-output'

  beforeAll(() => {
    // 面板页与控制台主窗口一样，打包后从产物目录里读（见 `index.ts`）。
    process.env.OUTPUT = OUTPUT_DIRECTORY
  })

  afterAll(() => {
    delete process.env.OUTPUT
  })

  afterEach(() => {
    delete process.env.VITE_DEV_SERVER_URL
  })

  const actions = {
    openMainWindow: async () => undefined,
    quit: () => undefined,
  }

  function createPanel(): TrayPanelManager {
    const panelManager = new TrayPanelManager(mocks.tray as unknown as import('electron').Tray, actions)
    panelManager.init()
    return panelManager
  }

  function resizeListener(): (event: unknown, height: unknown) => void {
    const listener = mocks.onIpc.mock.calls.find(([channel]) => channel === 'tray-panel:resize')?.[1] as
      | ((event: unknown, height: unknown) => void)
      | undefined
    if (!listener) throw new Error('tray-panel:resize listener was never registered')
    return listener
  }

  it('把「打开主界面 / 退出」这两个只有宿主做得到的动作递出去', async () => {
    let opened = 0
    let quit = 0
    const panelManager = new TrayPanelManager(mocks.tray as unknown as import('electron').Tray, {
      openMainWindow: async () => {
        opened += 1
      },
      quit: () => {
        quit += 1
      },
    })
    panelManager.init()

    const openHandler = mocks.handle.mock.calls.find(([channel]) => channel === 'tray-panel:open-main-window')?.[1] as (() => Promise<void>) | undefined
    const quitHandler = mocks.onIpc.mock.calls.find(([channel]) => channel === 'tray-panel:quit')?.[1] as (() => void) | undefined

    await openHandler?.()
    quitHandler?.()

    expect({ opened, quit }).toEqual({ opened: 1, quit: 1 })
    panelManager.destroy()
  })

  it('开发期从 Vite dev server 取面板页，打包后读产物目录里的同名文件', () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/'
    const developing = createPanel()
    developing.show()
    // 尾斜杠不能拼成 `//tray.html`。
    expect(mocks.panelWindows.at(-1)?.loadURL).toHaveBeenCalledWith('http://localhost:5173/tray.html')
    developing.destroy()

    delete process.env.VITE_DEV_SERVER_URL
    const packaged = createPanel()
    packaged.show()
    // 两个 HTML 入口同在 Vite 根下，所以产物里也只差一个文件名。
    expect(mocks.panelWindows.at(-1)?.loadFile).toHaveBeenCalledWith(`${OUTPUT_DIRECTORY}/render/tray.html`)
    packaged.destroy()
  })

  it('按页面上报的内容高度改窗口尺寸，并带上透明留白重新落位', () => {
    const panelManager = createPanel()
    panelManager.show()
    const panel = mocks.panelWindows.at(-1)
    if (!panel) throw new Error('panel window was never created')

    resizeListener()({ sender: panel.webContents }, 520)

    // 422 宽的窗口居中到 x=512 的托盘图标下，macOS 顶部再扣掉那圈透明留白。
    expect(panel.setBounds).toHaveBeenLastCalledWith({ x: 301, y: 4, width: 422, height: 520 }, false)
    panelManager.destroy()
  })

  it('挡掉不属于面板窗口的尺寸上报', () => {
    const panelManager = createPanel()
    panelManager.show()
    const panel = mocks.panelWindows.at(-1)
    if (!panel) throw new Error('panel window was never created')
    panel.setBounds.mockClear()

    resizeListener()({ sender: { on: vi.fn() } }, 520)

    expect(panel.setBounds).not.toHaveBeenCalled()
    panelManager.destroy()
  })

  it('尺寸上报会被夹在最小与最大高度之间', () => {
    const panelManager = createPanel()
    panelManager.show()
    const panel = mocks.panelWindows.at(-1)
    if (!panel) throw new Error('panel window was never created')

    resizeListener()({ sender: panel.webContents }, 10)

    expect(panel.setBounds).toHaveBeenLastCalledWith({ x: 301, y: 4, width: 422, height: 380 }, false)
    panelManager.destroy()
  })
})

describe('托盘面板定位', () => {
  it('macOS 扣除透明留白，让可见面板保持 8px 间距', () => {
    const position = resolveTrayPanelPosition(
      {
        trayBounds: { x: 500, y: 0, width: 24, height: 24 },
        workArea: { x: 0, y: 24, width: 1_440, height: 876 },
        height: 600,
        platform: 'darwin',
      },
    )

    expect(position).toEqual({ x: 301, y: 4 })
    expect(position.y + 28).toBe(32)
  })

  it('Windows 使用窗口底部定位，同样扣除透明留白', () => {
    const position = resolveTrayPanelPosition(
      {
        trayBounds: { x: 500, y: 800, width: 24, height: 24 },
        workArea: { x: 0, y: 24, width: 1_440, height: 876 },
        height: 600,
        platform: 'win32',
      },
    )

    expect(position).toEqual({ x: 301, y: 220 })
    expect(position.y + 600 - 28).toBe(792)
  })
})

describe('托盘菜单结构', () => {
  it('运行中：状态行 + 复制地址 + 停止 + 打开主界面 + 退出', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()

    expect(labels()).toEqual(['运行中 · 19300', '复制接入地址', '停止代理服务', '打开主界面', '退出 OSW'])
  })

  it('已停止：状态行与启停项一起翻转，菜单项数量不变', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: false, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()

    expect(labels()).toEqual(['已停止', '复制接入地址', '启动代理服务', '打开主界面', '退出 OSW'])
    expect(mocks.tray.setToolTip).toHaveBeenLastCalledWith('OSW · 已停止')
  })

  it('状态行不可点击，其余条目都可点击', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()

    expect(findItem('运行中 · 19300').enabled).toBe(false)
    expect(findItem('运行中 · 19300').click).toBeUndefined()
    for (const label of ['停止代理服务', '打开主界面', '退出 OSW']) {
      expect(findItem(label).enabled).not.toBe(false)
      expect(typeof findItem(label).click).toBe('function')
    }
  })

  it('复制接入地址：子菜单按客户端类型列出两个 Base URL，通配监听地址回落到回环地址', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '0.0.0.0', port: 19300 })
    manager = await initRunning()

    const copyItem = findItem('复制接入地址')
    expect(copyItem.enabled).not.toBe(false)
    expect((copyItem.submenu as MenuItem[]).map(item => item.label)).toEqual([
      'OpenAI · http://127.0.0.1:19300/v1',
      'Anthropic · http://127.0.0.1:19300',
    ])
  })

  it('点一条 Base URL 就把它写进剪贴板，并借用 tooltip 给出回执', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()

    const endpointItem = (findItem('复制接入地址').submenu as MenuItem[])[1]
    click(endpointItem)

    expect(mocks.clipboard.writeText).toHaveBeenCalledWith('http://127.0.0.1:19300')
    expect(mocks.tray.setToolTip).toHaveBeenLastCalledWith('接入地址已复制')
  })

  it('右键仍打开同一份原生菜单（Linux 按平台约定挂 setContextMenu）', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()

    const listener = mocks.tray.on.mock.calls.find(([event]) => event === 'right-click')?.[1] as (() => void) | undefined

    // Linux 的 StatusNotifierItem 对自绘弹层支持不稳定，托盘保留 `setContextMenu` 这条平台约定，
    // 不注册 left / right-click（见 `tray-manager.ts`）。两个平台分支各自断言，
    // 而不是在 Linux 上静默跳过 —— 否则这条用例在 Linux CI 上永远红。
    if (process.platform === 'linux') {
      expect(listener).toBeUndefined()
      expect(mocks.tray.setContextMenu).toHaveBeenCalled()
      return
    }

    listener?.()

    expect(mocks.tray.popUpContextMenu).toHaveBeenCalledTimes(1)
  })

})

describe('托盘启停与轮询', () => {
  it('已停止时点击启停项会启动代理，菜单随后翻成「停止代理服务」', async () => {
    const server = fakeProxyServer(false)
    manager = await initRunning()
    expect(labels()).toContain('启动代理服务')

    click(findItem('启动代理服务'))

    await vi.waitFor(() => expect(mocks.startProxyServer).toHaveBeenCalled())
    expect(mocks.stopProxyServer).not.toHaveBeenCalled()
    expect(server.isRunning()).toBe(true)
    await vi.waitFor(() => expect(labels()).toContain('停止代理服务'))
  })

  it('运行中时点击启停项会停止代理', async () => {
    const server = fakeProxyServer(true)
    manager = await initRunning()
    expect(labels()).toContain('停止代理服务')

    click(findItem('停止代理服务'))

    await vi.waitFor(() => expect(mocks.stopProxyServer).toHaveBeenCalled())
    expect(mocks.startProxyServer).not.toHaveBeenCalled()
    expect(server.isRunning()).toBe(false)
    await vi.waitFor(() => expect(labels()).toContain('启动代理服务'))
  })

  it('状态没变就不重建菜单，避免把正开着的菜单顶掉', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()
    expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(1)

    // 白盒调用私有轮询：定时器本身不在这里验。
    const poll = (manager as unknown as { refreshStatus: () => Promise<void> }).refreshStatus
    await poll.call(manager)

    expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(1)
  })

  it('状态读取失败时保留上一份快照，不会把菜单说成「已停止」', async () => {
    mocks.getProxyServerStatus.mockResolvedValueOnce({ running: true, host: '127.0.0.1', port: 19300 })
    mocks.getProxyServerStatus.mockRejectedValue(new Error('database is locked'))
    manager = await initRunning()

    const poll = (manager as unknown as { refreshStatus: () => Promise<void> }).refreshStatus
    await poll.call(manager)

    expect(labels()).toContain('运行中 · 19300')
    expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(1)
  })

  it('状态一次都没读到过时只挂兜底菜单，托盘不能变成死路', async () => {
    mocks.getProxyServerStatus.mockRejectedValue(new Error('database is locked'))
    manager = new TrayManager()
    manager.init(mocks.mainWindow as unknown as BrowserWindow)

    await vi.waitFor(() => expect(mocks.buildFromTemplate).toHaveBeenCalled())
    expect(labels()).toEqual(['打开主界面', '退出 OSW'])
  })
})
