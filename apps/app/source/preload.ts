/**
 * 预加载脚本：宿主与渲染进程之间唯一的接口面。
 *
 * 两个原则：
 *   1. **不暴露通用通道**。原来是 `sendMessage(channel, data)` / `onMessage(channel, cb)`
 *      一对万能桥——它把「渲染进程能干什么」交回给了渲染进程自己，contextIsolation 白开了。
 *      现在每个能力一个具名方法。
 *   2. **运行时信息由主进程给，不在渲染层重算**。管理 API 的基地址属于「启动之后才知道」
 *      的东西（端口可以被用户改），所以用一次同步 IPC 取回来，并通过 `contextBridge`
 *      注入 `window.__OSW__`——控制台在它的模块脚本里直接读。
 */

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

/**
 * `download()` 的结果，与主进程 `updater.ts` 的 `UpdateDownloadResult` 一致。
 *
 * preload 是另一份构建产物，不能 import 主进程模块，所以这里再声明一遍；
 * 渲染层那份在 `packages/console/source/vite-env.d.ts`。三处改一处就得同步三处。
 */
export type UpdateDownloadResult =
  | 'downloading'
  | 'download-complete'
  | 'manual-download'
  | 'failed'

const updaterApi = {
  getState: (): Promise<UpdateState> => ipcRenderer.invoke('updater:get-state'),
  check: (): Promise<UpdateState> => ipcRenderer.invoke('updater:check'),
  download: (): Promise<UpdateDownloadResult> => ipcRenderer.invoke('updater:download'),
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
  openExternal: (url: string): void => ipcRenderer.send('open-external', url),
  // 打开数据目录。路径由主进程自己取（渲染进程送路径等于把「打开任意目录」交回给页面），
  // 所以这里没有参数；失败时把拒绝原样透给调用方，由界面提示。
  openDataDirectory: (): Promise<void> => ipcRenderer.invoke('open-data-directory'),
  // 主题保存在渲染层的本地偏好里，主进程不能直接读；渲染层在主题变化时把生效值
  // 推过来，只用于托盘面板与主窗口保持一致。
  setTheme: (theme: 'light' | 'dark'): void => ipcRenderer.send('appearance:set-theme', theme),
  onFullScreenChanged: (callback: (fullScreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fullScreen: boolean) => callback(fullScreen)
    ipcRenderer.on('window:full-screen-changed', listener)
    return () => ipcRenderer.removeListener('window:full-screen-changed', listener)
  },
  getFullScreenState: (): Promise<boolean> => ipcRenderer.invoke('window:get-full-screen-state'),
  updater: updaterApi,
})

/**
 * 运行时信息。
 *
 * 同步取：渲染进程从 `file://` 加载，控制台的第一个请求之前就得知道管理服务在哪儿。
 * 主进程在 `whenReady` 之前就注册了这个 handler，所以同步调用不会死等。
 */
const runtime = ipcRenderer.sendSync('runtime:get-config') as { apiBase: string }

contextBridge.exposeInMainWorld('__OSW__', {
  apiBase: runtime.apiBase,
})
