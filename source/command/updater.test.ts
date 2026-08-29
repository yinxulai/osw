import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateInfo } from 'electron-updater'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const eventHandlers = handlers.get(event) ?? []
      eventHandlers.push(handler)
      handlers.set(event, eventHandlers)
      return autoUpdater
    }),
    checkForUpdates: vi.fn<() => Promise<unknown>>(),
    downloadUpdate: vi.fn<() => Promise<unknown>>(),
    quitAndInstall: vi.fn(),
  }

  return {
    handlers,
    autoUpdater,
    app: {
      getVersion: vi.fn(() => '1.0.0-beta.10'),
      isPackaged: false,
    },
    shell: {
      openExternal: vi.fn<(_url: string) => Promise<void>>(),
    },
  }
})

vi.mock('electron', () => ({ app: mocks.app, shell: mocks.shell }))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))

import { UpdaterManager } from './updater'

const latestReleaseUrl = 'https://github.com/yinxulai/one-switch/releases/tag/v1.1.0'

function updateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: '1.1.0',
    files: [
      { url: 'one-switch-1.1.0.exe', sha512: 'checksum', size: 2048 },
      { url: 'downloads/one-switch-1.1.0.blockmap', sha512: 'checksum' },
    ],
    path: 'one-switch-1.1.0.exe',
    sha512: 'checksum',
    releaseDate: '2026-08-29T12:00:00.000Z',
    releaseNotes: '<p>Changes</p>',
    ...overrides,
  }
}

function emit(event: string, ...args: unknown[]) {
  for (const handler of mocks.handlers.get(event) ?? []) handler(...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.app.isPackaged = false
  mocks.autoUpdater.autoDownload = true
  mocks.autoUpdater.autoInstallOnAppQuit = true
  mocks.autoUpdater.allowPrerelease = false
  mocks.autoUpdater.checkForUpdates.mockResolvedValue(null)
  mocks.autoUpdater.downloadUpdate.mockResolvedValue([])
  mocks.shell.openExternal.mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UpdaterManager', () => {
  it('initializes electron-updater for user-controlled prerelease updates', () => {
    const manager = new UpdaterManager()

    expect(mocks.autoUpdater.autoDownload).toBe(false)
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(mocks.autoUpdater.allowPrerelease).toBe(true)
    expect(manager.getState()).toMatchObject({
      status: 'idle',
      info: {
        currentVersion: '1.0.0-beta.10',
        latestVersion: '1.0.0-beta.10',
      },
    })
  })

  it('notifies subscribers immediately and stops after unsubscribe', () => {
    const manager = new UpdaterManager()
    const listener = vi.fn()
    const unsubscribe = manager.subscribe(listener)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenLastCalledWith(manager.getState())

    emit('checking-for-update')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(manager.getState().status).toBe('checking')

    unsubscribe()
    emit('download-progress', { percent: 25 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('maps available update metadata and release assets', () => {
    const manager = new UpdaterManager()

    emit('update-available', updateInfo())

    expect(manager.getState()).toMatchObject({
      status: 'update-available',
      errorMessage: null,
      downloadProgress: null,
      info: {
        currentVersion: '1.0.0-beta.10',
        latestVersion: '1.1.0',
        releaseNotes: '<p>Changes</p>',
        releaseDate: '2026-08-29T12:00:00.000Z',
        releaseUrl: latestReleaseUrl,
        assets: [
          { name: 'one-switch-1.1.0.exe', size: 2048, downloadUrl: 'one-switch-1.1.0.exe' },
          {
            name: 'one-switch-1.1.0.blockmap',
            size: 0,
            downloadUrl: 'downloads/one-switch-1.1.0.blockmap',
          },
        ],
        preferredAsset: {
          name: 'one-switch-1.1.0.exe',
          size: 2048,
          downloadUrl: 'one-switch-1.1.0.exe',
        },
      },
    })
  })

  it('maps array release notes and an empty asset list', () => {
    const manager = new UpdaterManager()

    emit('update-not-available', updateInfo({
      files: [],
      releaseNotes: [
        { version: '1.1.0', note: 'First change' },
        { version: '1.0.9', note: null },
      ],
    }))

    expect(manager.getState()).toMatchObject({
      status: 'up-to-date',
      info: {
        releaseNotes: 'First change\n1.0.9',
        assets: [],
      },
    })
    expect(manager.getState().info?.preferredAsset).toBeUndefined()
  })

  it('supplies safe defaults for optional release metadata', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T18:30:00.000Z'))
    const manager = new UpdaterManager()

    emit('update-available', updateInfo({
      releaseNotes: undefined,
      releaseDate: undefined,
    }))

    expect(manager.getState().info).toMatchObject({
      releaseNotes: '',
      releaseDate: '2026-08-29T18:30:00.000Z',
    })
    vi.useRealTimers()
  })

  it('tracks download progress and completion', () => {
    const manager = new UpdaterManager()

    emit('download-progress', { percent: 42.5 })
    expect(manager.getState()).toMatchObject({
      status: 'downloading',
      downloadProgress: 0.425,
    })

    emit('update-downloaded', updateInfo())
    expect(manager.getState()).toMatchObject({
      status: 'downloaded',
      downloadProgress: 1,
      downloadedFile: null,
      info: { latestVersion: '1.1.0' },
    })
  })

  it('adds context to development errors and preserves packaged errors', () => {
    const manager = new UpdaterManager()

    emit('error', new Error('network unavailable'))
    expect(manager.getState()).toMatchObject({
      status: 'error',
      errorMessage: '开发环境无法检查更新：network unavailable',
      downloadProgress: null,
    })

    mocks.app.isPackaged = true
    emit('error', new Error('signature rejected'))
    expect(manager.getState().errorMessage).toBe('signature rejected')
  })

  it('checks once and ignores checks while busy', async () => {
    const manager = new UpdaterManager()

    await manager.checkForUpdates()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    emit('checking-for-update')
    await manager.checkForUpdates()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    emit('download-progress', { percent: 5 })
    await manager.checkForUpdates()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('turns thrown check failures into an error state', async () => {
    const manager = new UpdaterManager()
    mocks.autoUpdater.checkForUpdates.mockRejectedValue('offline')

    await manager.checkForUpdates()

    expect(manager.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'offline',
    })
  })

  it('does not overwrite an error already emitted by electron-updater', async () => {
    const manager = new UpdaterManager()
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      emit('error', new Error('provider error'))
      throw new Error('wrapper error')
    })

    await manager.checkForUpdates()

    expect(manager.getState().errorMessage).toBe('开发环境无法检查更新：provider error')
  })

  it('downloads an available update and reports success', async () => {
    const manager = new UpdaterManager()
    emit('update-available', updateInfo())

    await expect(manager.downloadUpdate()).resolves.toBe(true)

    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(manager.getState()).toMatchObject({
      status: 'downloading',
      downloadProgress: 0,
      errorMessage: null,
    })
  })

  it('rejects downloads when no update is available or one is in progress', async () => {
    const manager = new UpdaterManager()

    await expect(manager.downloadUpdate()).resolves.toBe(false)
    expect(manager.getState()).toMatchObject({
      status: 'error',
      errorMessage: '当前没有可下载的更新',
    })

    emit('download-progress', { percent: 10 })
    await expect(manager.downloadUpdate()).resolves.toBe(false)
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('reports download failures', async () => {
    const manager = new UpdaterManager()
    emit('update-available', updateInfo())
    mocks.autoUpdater.downloadUpdate.mockRejectedValue(new Error('disk full'))

    await expect(manager.downloadUpdate()).resolves.toBe(false)

    expect(manager.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'disk full',
      downloadProgress: null,
    })
  })

  it('opens the exact release instead of downloading on macOS', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const manager = new UpdaterManager()
    emit('update-available', updateInfo())

    await expect(manager.downloadUpdate()).resolves.toBe(false)

    expect(mocks.shell.openExternal).toHaveBeenCalledWith(latestReleaseUrl)
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('installs a downloaded update on supported platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo())

    await manager.installUpdate()

    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(mocks.shell.openExternal).not.toHaveBeenCalled()
  })

  it('opens the release page when no update has been downloaded', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const manager = new UpdaterManager()

    await manager.installUpdate()

    expect(mocks.shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/yinxulai/one-switch/releases/latest',
    )
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('falls back to the release page for manual installation', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const manager = new UpdaterManager()
    emit('update-available', updateInfo())

    await manager.installUpdate()

    expect(mocks.shell.openExternal).toHaveBeenCalledWith(latestReleaseUrl)
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})
