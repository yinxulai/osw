import { afterEach, describe, expect, it, vi } from 'vitest'
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

  return {
    tray,
    mainWindow,
    Tray,
    app: { quit: vi.fn(), dock: { show: vi.fn(), hide: vi.fn() } },
    clipboard: { writeText: vi.fn() },
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
    handle: vi.fn(),
    removeHandler: vi.fn(),
    onIpc: vi.fn(),
    offIpc: vi.fn(),
    nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), off: vi.fn() },
    screen: { getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })) },
    getProxyServerStatus: vi.fn(),
    getTrayLogicalModels: vi.fn(),
    startProxyServer: vi.fn(),
    stopProxyServer: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  Tray: mocks.Tray,
  BrowserWindow: class {},
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  clipboard: mocks.clipboard,
  ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler, on: mocks.onIpc, off: mocks.offIpc },
  nativeTheme: mocks.nativeTheme,
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
  getTrayLogicalModels: mocks.getTrayLogicalModels,
  startProxyServer: mocks.startProxyServer,
  stopProxyServer: mocks.stopProxyServer,
}))

import { TrayManager } from './tray-manager'
import { TrayPanelManager, buildTrayPanelState, resolveTrayPanelPosition } from './tray-panel'

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

describe('托盘面板状态', () => {
  it('把应用图标、主题、语言与可直接展示的逻辑模型列表一次装进状态', () => {
    const state = buildTrayPanelState({ running: true, host: '0.0.0.0', port: 19300 }, 'dark', [
      {
        id: 'default',
        name: 'default',
        models: [
          {
            id: 'model_1',
            providerId: 'prov_1',
            providerName: 'Primary',
            modelName: 'gpt-test',
            protocols: ['openai-completions'],
            conversionProtocols: ['openai-responses'],
            enabled: true,
            modelEnabled: true,
            cooling: false,
            avgTps: 50,
            avgTtftMilliseconds: 250,
          },
        ],
      },
    ])

    expect(state).toEqual(expect.objectContaining({
      running: true,
      theme: 'dark',
      locale: 'zh-CN',
    }))
    expect(state.iconUrl).toBeTruthy()
    expect(state.protocolNames['openai-responses']).toBe('OpenAI Responses')
    expect(state.logicalModels).toEqual([
      {
        id: 'default',
        name: 'default',
        models: [
          expect.objectContaining({
            id: 'model_1',
            tps: '50',
            ttft: '250ms',
          }),
        ],
      },
    ])
  })

  it('启停 IPC 返回完整面板状态，而不是只回一份裸快照', async () => {
    const actions = {
      getSnapshot: () => ({ running: false, host: '127.0.0.1', port: 19301 }),
      getLogicalModels: async () => [],
      toggleProxy: async () => undefined,
      openMainWindow: async () => undefined,
      quit: () => undefined,
    }
    const panelManager = new TrayPanelManager(mocks.tray as unknown as import('electron').Tray, actions)
    panelManager.init()

    const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'tray-panel:toggle')?.[1] as (() => Promise<unknown>) | undefined
    expect(handler).toBeTypeOf('function')
    await expect(handler?.()).resolves.toEqual(expect.objectContaining({
      running: false,
      logicalModels: [],
    }))

    panelManager.destroy()
  })

  it('支持托盘页面按内容高度上报窗口尺寸', () => {
    const actions = {
      getSnapshot: () => ({ running: false, host: '127.0.0.1', port: 19301 }),
      getLogicalModels: async () => [],
      toggleProxy: async () => undefined,
      openMainWindow: async () => undefined,
      quit: () => undefined,
    }
    const panelManager = new TrayPanelManager(mocks.tray as unknown as import('electron').Tray, actions)
    panelManager.init()

    const listener = mocks.onIpc.mock.calls.find(([channel]) => channel === 'tray-panel:resize')?.[1] as
      | ((event: unknown, height: unknown) => void)
      | undefined
    expect(listener).toBeTypeOf('function')
    listener?.({ sender: {} }, 520)

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

  it('右键仍打开同一份原生菜单', async () => {
    mocks.getProxyServerStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 19300 })
    manager = await initRunning()

    const listener = mocks.tray.on.mock.calls.find(([event]) => event === 'right-click')?.[1] as (() => void) | undefined
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
