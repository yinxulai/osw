/// <reference types="vite/client" />

type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
}

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseDate: string
  releaseUrl: string
  assets: ReleaseAsset[]
  preferredAsset?: ReleaseAsset
}

interface UpdateState {
  status: UpdateCheckStatus
  info: UpdateInfo | null
  errorMessage: string | null
  downloadProgress: number | null
  downloadedFile: string | null
}

interface UpdaterAPI {
  getState: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<string | null>
  install: () => Promise<void>
  openReleases: () => Promise<void>
  onStateChanged: (callback: (state: UpdateState) => void) => () => void
}

interface ElectronAPI {
  platform: string
  sendMessage: (channel: string, data: unknown) => void
  onMessage: (channel: string, callback: (...args: unknown[]) => void) => void
  updater: UpdaterAPI
}

interface Window {
  electronAPI: ElectronAPI
}
