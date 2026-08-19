import { app, BrowserWindow, Menu, nativeImage, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer } from '@server/index'
import { getRuntimeProfile } from '@common/runtime-profile'
import { ElectronSecretStore } from './secret-store'
import { TrayManager } from './tray-manager'
import { AutoLaunchManager } from './auto-launch'
import { UpdaterManager, type UpdateState } from './updater'
// Vite 将 build/icon.png 打包为 data URL，避免运行时路径解析问题。
// Windows 任务栏/窗口图标需要位图，PNG 可被 nativeImage 直接识别。
import windowIconPng from '../../build/icon.png?url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The built directory structure
//
// ├─┬ dist
// │ ├─┬ command
// │ │ ├── index.js        > Electron Main
// │ │ └── preload.js
// │ ├─┬ server
// │ │   ...
// │ └─┬ render
// │     ...

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const runtimeProfile = getRuntimeProfile(isDevelopment ? 'development' : 'production')

process.env.DIST = path.join(__dirname, '..')
process.env.VITE_PUBLIC = isDevelopment
  ? path.join(process.cwd(), 'source/render/public')
  : path.join(process.env.DIST, 'render')

app.setPath('userData', path.join(app.getPath('appData'), runtimeProfile.userDataDirectoryName))

let win: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let autoLaunchManager: AutoLaunchManager | null = null
let updaterManager: UpdaterManager | null = null

// Windows 任务栏图标依赖 AppUserModelID；必须在创建任何窗口前设置，
// 否则系统会把进程归到默认 Electron 应用，导致显示默认图标。
if (process.platform === 'win32') {
  app.setAppUserModelId('com.yinxulai.one-switch')
}

function broadcastUpdateState(state: UpdateState) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updater:state-changed', state)
  }
}

function registerUpdaterIpc() {
  const updater = new UpdaterManager()
  updater.subscribe(broadcastUpdateState)
  updaterManager = updater

  ipcMain.handle('updater:get-state', () => updater.getState())
  ipcMain.handle('updater:check', () => updater.checkForUpdates())
  ipcMain.handle('updater:download', () => updater.downloadUpdate())
  ipcMain.handle('updater:install', () => updater.installUpdate())
  ipcMain.handle('updater:open-releases', () => updater.openReleasesPage())
}

registerUpdaterIpc()

function resolveWindowIcon() {
  // Vite 把 ?url 解析为 data URL，开发/打包后均可直接使用，
  // 避免生产环境下 build/ 目录未被复制到 dist 的路径问题。
  // Windows 任务栏/窗口图标接受 PNG；exe/安装包图标由 electron-builder 使用 icon.ico。
  return nativeImage.createFromDataURL(windowIconPng)
}

function createWindow() {
  win = new BrowserWindow({
    title: 'One Switch',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 移除默认菜单栏
  win.setMenuBarVisibility(false)
  if (process.platform === 'darwin') {
    // 保留系统编辑菜单，否则 Cmd+V 等原生输入快捷键会失效。
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]))
  }

  if (isDevelopment) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(process.env.DIST!, 'render', 'index.html'))
  }
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData')
  try {
    await startServer({
      dataDir: userDataDir,
      secretStore: new ElectronSecretStore(path.join(userDataDir, 'secrets.json')),
      runtimeProfile,
    })
  } catch (error) {
    console.error('[one-switch] failed to start server', error)
    app.quit()
    return
  }

  createWindow()

  // 初始化系统托盘
  try {
    trayManager = new TrayManager()
    trayManager.init(win!)
  } catch (error) {
    trayManager = null
    console.error('[one-switch] failed to initialize tray', error)
  }

  // 开发环境不应修改系统登录项。
  if (runtimeProfile.environment === 'production') {
    autoLaunchManager = new AutoLaunchManager()
    void autoLaunchManager.init()
  } else {
    console.log('[auto-launch] skipped in development')
  }

  // 启动 10 秒后静默检查一次更新，避免阻塞启动。
  // 仅在生产环境执行，开发环境下版本号无意义。
  if (runtimeProfile.environment === 'production' && updaterManager) {
    setTimeout(() => {
      void updaterManager!.checkForUpdates()
    }, 10_000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (trayManager) void trayManager.showWindow()
  })
})

app.on('window-all-closed', () => {
  // 不退出应用，保持在托盘运行
  // if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (trayManager) {
    trayManager.prepareForQuit()
  }
  void stopServer()
})
