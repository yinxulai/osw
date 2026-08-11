import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  // 后续可以添加 IPC 调用
  sendMessage: (channel: string, data: unknown) => ipcRenderer.send(channel, data),
  onMessage: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
})
