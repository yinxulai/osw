/**
 * 托盘面板专用的最小桥。
 *
 * 面板只是一张主进程现场拼出来的静态页，不需要控制台的 updater/runtime 能力。
 * 把它与主窗口 preload 分开后，这个窗口能做的事只有下面五个固定动作；没有通用
 * channel，稍后在主进程里即使面板页被替换，也拿不到别的 IPC 能力。
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { TrayPanelState } from '@common/tray-panel'

const trayPanelApi = {
  getState: (): Promise<TrayPanelState> => ipcRenderer.invoke('tray-panel:get-state'),
  toggleProxy: (): Promise<TrayPanelState> => ipcRenderer.invoke('tray-panel:toggle'),
  openMainWindow: (): Promise<void> => ipcRenderer.invoke('tray-panel:open-main-window'),
  quit: (): Promise<void> => ipcRenderer.invoke('tray-panel:quit'),
  resize: (height: number): void => ipcRenderer.send('tray-panel:resize', height),
  onStateChanged: (callback: (state: TrayPanelState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: TrayPanelState) => callback(state)
    ipcRenderer.on('tray-panel:state-changed', listener)
    return () => ipcRenderer.removeListener('tray-panel:state-changed', listener)
  },
}

contextBridge.exposeInMainWorld('trayPanel', trayPanelApi)
