import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateInfo } from 'electron-updater'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const autoUpdater = {
    autoDownload: true,
    // 三个开关的初始值都取「代码会写成的反面」，这样断言才有意义：
    // 否则「代码根本没赋值」也会因为和初始值相同而通过。
    autoInstallOnAppQuit: false,
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

import { UpdaterManager, isMajorUpgrade } from './updater'

const latestReleaseUrl = 'https://github.com/yinxulai/osw/releases/tag/v1.1.0'
const nextMajorReleaseUrl = 'https://github.com/yinxulai/osw/releases/tag/v2.0.0'

/** 真实产物名与顺序（照抄 v1.1.0-beta.9 的 `latest*.yml`，别理想化）。 */
const windowsFiles = [
  { url: 'OSW-1.1.0-win.exe', sha512: 'checksum', size: 194211246 },
  { url: 'OSW-1.1.0-win-x64.exe', sha512: 'checksum', size: 96353572 },
  { url: 'OSW-1.1.0-win-arm64.exe', sha512: 'checksum', size: 98418281 },
]

const macFiles = [
  { url: 'OSW-1.1.0-mac-arm64.zip', sha512: 'checksum', size: 106595669 },
  { url: 'OSW-1.1.0-mac-x64.zip', sha512: 'checksum', size: 113790882 },
  { url: 'OSW-1.1.0-mac-x64.dmg', sha512: 'checksum', size: 117927813 },
  { url: 'OSW-1.1.0-mac-arm64.dmg', sha512: 'checksum', size: 110720617 },
]

const linuxFiles = [
  { url: 'OSW-1.1.0-linux-x86_64.AppImage', sha512: 'checksum', size: 119007720 },
]

function updateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: '1.1.0',
    files: [
      { url: 'osw-1.1.0.exe', sha512: 'checksum', size: 2048 },
      { url: 'downloads/osw-1.1.0.blockmap', sha512: 'checksum' },
    ],
    path: 'osw-1.1.0.exe',
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
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.app.isPackaged = false
  mocks.autoUpdater.autoDownload = true
  mocks.autoUpdater.autoInstallOnAppQuit = false
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
    // 非 macOS 保留「退出时自动安装」：用户已经下过的东西，退出时该装上。
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(mocks.autoUpdater.allowPrerelease).toBe(true)
    expect(manager.getState()).toMatchObject({
      status: 'idle',
      info: {
        currentVersion: '1.0.0-beta.10',
        latestVersion: '1.0.0-beta.10',
      },
    })
  })

  it('keeps macOS on manual DMG install instead of installing on quit', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    // 先摆成 true：断言 false 才能证明构造过程把它改回来了，而不是它本来就是 false。
    mocks.autoUpdater.autoInstallOnAppQuit = true

    const manager = new UpdaterManager()

    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(mocks.autoUpdater.autoDownload).toBe(false)
    expect(manager.getState().status).toBe('idle')
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
          { name: 'osw-1.1.0.exe', size: 2048, downloadUrl: 'osw-1.1.0.exe' },
          {
            name: 'osw-1.1.0.blockmap',
            size: 0,
            downloadUrl: 'downloads/osw-1.1.0.blockmap',
          },
        ],
        preferredAsset: {
          name: 'osw-1.1.0.exe',
          size: 2048,
          downloadUrl: 'osw-1.1.0.exe',
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

  it('picks the architecture-specific installer out of the Windows metadata', () => {
    const manager = new UpdaterManager()

    emit('update-available', updateInfo({ files: windowsFiles }))
    // 第一项是「不带架构段的多合一安装包」（194MB），不是这台 x64 机器要下的那个。
    expect(manager.getState().info?.preferredAsset?.name).toBe('OSW-1.1.0-win-x64.exe')

    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    emit('update-available', updateInfo({ files: windowsFiles }))
    expect(manager.getState().info?.preferredAsset?.name).toBe('OSW-1.1.0-win-arm64.exe')
  })

  it('picks the DMG for the running architecture on macOS', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const manager = new UpdaterManager()

    emit('update-available', updateInfo({ files: macFiles }))

    // 元数据第一项是 arm64 的 zip；手动安装要的是本架构的 DMG
    expect(manager.getState().info?.preferredAsset?.name).toBe('OSW-1.1.0-mac-x64.dmg')
  })

  it('picks the AppImage whose architecture token is x86_64 on Linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const manager = new UpdaterManager()

    emit('update-available', updateInfo({ files: linuxFiles }))

    expect(manager.getState().info?.preferredAsset?.name).toBe('OSW-1.1.0-linux-x86_64.AppImage')
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
      errorMessage: 'Cannot check for updates in development: network unavailable',
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

  it('keeps a downloaded update when a later check reports the same version', async () => {
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo())
    const statuses: string[] = []
    manager.subscribe(state => statuses.push(state.status))
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      emit('checking-for-update')
      emit('update-available', updateInfo())
    })

    await manager.checkForUpdates()

    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(statuses).toEqual(['downloaded'])
    expect(manager.getState()).toMatchObject({
      status: 'downloaded',
      downloadProgress: 1,
      info: { latestVersion: '1.1.0' },
    })
    await manager.installUpdate()
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('keeps a downloaded update when a later check fails', async () => {
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo())
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      emit('checking-for-update')
      emit('error', new Error('network unavailable'))
      throw new Error('network unavailable')
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      status: 'downloaded',
      downloadProgress: 1,
      errorMessage: 'Cannot check for updates in development: network unavailable',
      info: { latestVersion: '1.1.0' },
    })
    await manager.installUpdate()
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('keeps a downloaded update when the check promise rejects without an error event', async () => {
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo())
    mocks.autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'))

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      status: 'downloaded',
      downloadProgress: 1,
      errorMessage: 'offline',
      info: { latestVersion: '1.1.0' },
    })
  })

  it('clears a recheck error once the same version is confirmed again', async () => {
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo())
    mocks.autoUpdater.checkForUpdates.mockImplementationOnce(async () => {
      emit('checking-for-update')
      emit('error', new Error('network unavailable'))
      throw new Error('network unavailable')
    })
    await manager.checkForUpdates()

    mocks.autoUpdater.checkForUpdates.mockImplementationOnce(async () => {
      emit('checking-for-update')
      emit('update-available', updateInfo())
    })
    await manager.checkForUpdates()

    expect(manager.getState()).toMatchObject({
      status: 'downloaded',
      errorMessage: null,
      downloadProgress: 1,
      info: { latestVersion: '1.1.0' },
    })
  })

  it('replaces a downloaded update when a later check reports a newer version', async () => {
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo())
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      emit('checking-for-update')
      emit('update-available', updateInfo({ version: '1.2.0' }))
    })

    await manager.checkForUpdates()

    expect(manager.getState()).toMatchObject({
      status: 'update-available',
      downloadProgress: null,
      info: { latestVersion: '1.2.0' },
    })
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

    expect(manager.getState().errorMessage).toBe('Cannot check for updates in development: provider error')
  })

  it('downloads an available update and reports success', async () => {
    const manager = new UpdaterManager()
    emit('update-available', updateInfo())

    await expect(manager.downloadUpdate()).resolves.toBe('download-complete')

    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(manager.getState()).toMatchObject({
      status: 'downloading',
      downloadProgress: 0,
      errorMessage: null,
    })
  })

  it('rejects downloads when no update is available or one is in progress', async () => {
    const manager = new UpdaterManager()

    await expect(manager.downloadUpdate()).resolves.toBe('failed')
    expect(manager.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'There is no downloadable update right now',
    })

    emit('download-progress', { percent: 10 })
    // 已经在下了：不起第二次下载，也不该报成失败
    await expect(manager.downloadUpdate()).resolves.toBe('downloading')
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('reports download failures', async () => {
    const manager = new UpdaterManager()
    emit('update-available', updateInfo())
    mocks.autoUpdater.downloadUpdate.mockRejectedValue(new Error('disk full'))

    await expect(manager.downloadUpdate()).resolves.toBe('failed')

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

    await expect(manager.downloadUpdate()).resolves.toBe('manual-download')

    expect(mocks.shell.openExternal).toHaveBeenCalledWith(latestReleaseUrl)
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    // 转去下载页不是失败，界面上不该出现「下载失败」
    expect(manager.getState()).toMatchObject({ status: 'update-available', errorMessage: null })
  })

  it('flags an update that crosses a major version as manual only', () => {
    const manager = new UpdaterManager()

    emit('update-available', updateInfo({ version: '2.0.0' }))

    expect(manager.getState().info).toMatchObject({
      currentVersion: '1.0.0-beta.10',
      latestVersion: '2.0.0',
      requiresManualUpdate: true,
    })
  })

  it('keeps same-major updates on the built-in updater', () => {
    const manager = new UpdaterManager()

    emit('update-available', updateInfo({ version: '1.2.0-beta.3' }))

    expect(manager.getState().info?.requiresManualUpdate).toBe(false)
  })

  it('sends a major-version update to the release page instead of downloading', async () => {
    const manager = new UpdaterManager()
    emit('update-available', updateInfo({ version: '2.0.0' }))

    await expect(manager.downloadUpdate()).resolves.toBe('manual-download')

    expect(mocks.shell.openExternal).toHaveBeenCalledWith(nextMajorReleaseUrl)
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    // 和 macOS 一样：不是失败，界面不该报错
    expect(manager.getState()).toMatchObject({ status: 'update-available', errorMessage: null })
  })

  it('never auto-installs across a major version, even when a package is already downloaded', async () => {
    const manager = new UpdaterManager()
    emit('update-downloaded', updateInfo({ version: '2.0.0' }))

    await manager.installUpdate()

    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(mocks.shell.openExternal).toHaveBeenCalledWith(nextMajorReleaseUrl)
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
      'https://github.com/yinxulai/osw/releases/latest',
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

describe('isMajorUpgrade', () => {
  it('treats a different leading number as a major upgrade', () => {
    expect(isMajorUpgrade('1.0.0-beta.10', '2.0.0')).toBe(true)
    expect(isMajorUpgrade('2.0.0', '1.9.9')).toBe(true)
    expect(isMajorUpgrade('0.9.0', '1.0.0')).toBe(true)
  })

  it('treats everything inside one major number as a normal update', () => {
    expect(isMajorUpgrade('1.0.0-beta.10', '1.1.0')).toBe(false)
    // 预发布到正式版不算跨大版本
    expect(isMajorUpgrade('1.1.0-beta.9', '1.1.0')).toBe(false)
    expect(isMajorUpgrade('1.0.0', '1.0.1')).toBe(false)
  })

  it('falls back to manual whenever a version cannot be parsed', () => {
    expect(isMajorUpgrade('1.0.0', 'nightly')).toBe(true)
    expect(isMajorUpgrade('', '1.1.0')).toBe(true)
    expect(isMajorUpgrade('v1.1.0', '1.1.0')).toBe(false)
  })
})
