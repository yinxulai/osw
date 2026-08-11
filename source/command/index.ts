import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { startServer, stopServer } from '@server/index'

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

process.env.DIST = path.join(__dirname, '..')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.cwd(), 'source/render/public')
  : path.join(process.env.DIST, 'render')

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    title: 'One Switch',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(process.env.DIST!, 'render', 'index.html'))
  }
}

app.whenReady().then(() => {
  // 启动代理服务器
  const userDataDir = app.getPath('userData')
  startServer({ dataDir: userDataDir })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopServer()
  if (process.platform !== 'darwin') app.quit()
})
