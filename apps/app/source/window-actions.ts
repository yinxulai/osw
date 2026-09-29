import { app, BrowserWindow } from 'electron'
import { resolveWindowShortcut, type WindowAction } from './window-shortcuts'

interface WindowShortcutOptions {
  enableDevTools: boolean
}

function executeWindowAction(action: WindowAction, target: BrowserWindow): void {
  switch (action) {
    case 'minimize':
      target.minimize()
      return
    case 'close':
      target.close()
      return
    case 'quit':
      app.quit()
      return
    case 'undo':
      target.webContents.undo()
      return
    case 'redo':
      target.webContents.redo()
      return
    case 'cut':
      target.webContents.cut()
      return
    case 'copy':
      target.webContents.copy()
      return
    case 'paste':
      target.webContents.paste()
      return
    case 'selectAll':
      target.webContents.selectAll()
      return
    case 'reload':
      target.reload()
      return
    case 'forceReload':
      target.webContents.reloadIgnoringCache()
      return
    case 'resetZoom':
      target.webContents.setZoomLevel(0)
      return
    case 'zoomIn':
      target.webContents.setZoomLevel(target.webContents.getZoomLevel() + 0.5)
      return
    case 'zoomOut':
      target.webContents.setZoomLevel(target.webContents.getZoomLevel() - 0.5)
      return
    case 'toggleFullScreen':
      target.setFullScreen(!target.isFullScreen())
      return
    case 'toggleDevTools':
      target.webContents.toggleDevTools()
  }
}

export function installWindowShortcuts(target: BrowserWindow, options: WindowShortcutOptions): void {
  target.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const action = resolveWindowShortcut({
      key: input.key,
      meta: input.meta,
      control: input.control,
      shift: input.shift,
      alt: input.alt,
    }, process.platform)

    if (!action || (action === 'toggleDevTools' && !options.enableDevTools)) return
    event.preventDefault()
    executeWindowAction(action, target)
  })
}
