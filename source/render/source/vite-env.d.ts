/// <reference types="vite/client" />

interface ElectronAPI {
  platform: string
  sendMessage: (channel: string, data: unknown) => void
  onMessage: (channel: string, callback: (...args: unknown[]) => void) => void
}

interface Window {
  electronAPI: ElectronAPI
}
