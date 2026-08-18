import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer } from '@server/index'
import { getRuntimeProfile } from '@common/runtime-profile'
import { ElectronSecretStore } from './secret-store'
import { TrayManager } from './tray-manager'
import { AutoLaunchManager } from './auto-launch'

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

function createWindow() {
  win = new BrowserWindow({
    title: 'One Switch',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
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
  trayManager = new TrayManager()
  trayManager.init(win!)

  // 开发环境不应修改系统登录项。
  if (runtimeProfile.environment === 'production') {
    autoLaunchManager = new AutoLaunchManager()
    void autoLaunchManager.init()
  } else {
    console.log('[auto-launch] skipped in development')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (win) {
      win.show()
      win.focus()
    }
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
