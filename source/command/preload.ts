import { contextBridge, ipcRenderer } from 'electron'

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseDate: string
  releaseUrl: string
  assets: ReleaseAsset[]
  preferredAsset?: ReleaseAsset
}

export interface UpdateState {
  status: UpdateCheckStatus
  info: UpdateInfo | null
  errorMessage: string | null
  downloadProgress: number | null
  downloadedFile: string | null
}

const updaterApi = {
  getState: (): Promise<UpdateState> => ipcRenderer.invoke('updater:get-state'),
  check: (): Promise<UpdateState> => ipcRenderer.invoke('updater:check'),
  download: (): Promise<string | null> => ipcRenderer.invoke('updater:download'),
  install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  openReleases: (): Promise<void> => ipcRenderer.invoke('updater:open-releases'),
  onStateChanged: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('updater:state-changed', listener)
    return () => ipcRenderer.removeListener('updater:state-changed', listener)
  },
}

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  // 后续可以添加 IPC 调用
  sendMessage: (channel: string, data: unknown) => ipcRenderer.send(channel, data),
  onMessage: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  updater: updaterApi,
})
