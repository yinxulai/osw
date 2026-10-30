import { describe, expect, it } from 'vitest'
import { UpdaterController } from './updater-controller'

/** 构造一个可脚本化的假更新器端口；控制器脱离 React、脱离 Electron 独立运行。 */
function fakeUpdater(script: Partial<UpdaterAPI> = {}): UpdaterAPI & { emit: (state: UpdateState) => void } {
  let listener: ((state: UpdateState) => void) | null = null
  return {
    getState: script.getState ?? (async () => state('idle')),
    check: script.check ?? (async () => state('up-to-date')),
    download: script.download ?? (async () => 'download-complete'),
    install: script.install ?? (async () => {}),
    openReleases: script.openReleases ?? (async () => {}),
    onStateChanged: cb => {
      listener = cb
      return () => { listener = null }
    },
    emit: next => listener?.(next),
  }
}

function state(status: UpdateCheckStatus, extra: Partial<UpdateState> = {}): UpdateState {
  return { status, info: null, errorMessage: null, downloadProgress: null, downloadedFile: null, ...extra }
}

const withVersion = (status: UpdateCheckStatus, latestVersion: string, extra: Partial<UpdateState> = {}): UpdateState =>
  state(status, { info: { latestVersion } as UpdateState['info'], ...extra })

describe('UpdaterController', () => {
  it('reports availability from the injected port', () => {
    expect(new UpdaterController(undefined).available).toBe(false)
    expect(new UpdaterController(fakeUpdater()).available).toBe(true)
  })

  it('pulls the initial state and follows subscription updates', async () => {
    const port = fakeUpdater({ getState: async () => state('checking') })
    const controller = new UpdaterController(port)
    const stop = controller.start()
    await Promise.resolve()
    expect(controller.getSnapshot().status).toBe('checking')

    port.emit(withVersion('update-available', '2.0.0'))
    expect(controller.getSnapshot().status).toBe('update-available')
    stop()
  })

  it('keeps the same snapshot reference when an equal-valued state arrives', async () => {
    const port = fakeUpdater({ getState: async () => withVersion('update-available', '2.0.0') })
    const controller = new UpdaterController(port)
    controller.start()
    await Promise.resolve()
    const snapshot = controller.getSnapshot()

    let notifications = 0
    controller.subscribe(() => { notifications += 1 })
    // 再推一份字段完全相同的状态：引用不该变，也不该通知。
    port.emit(withVersion('update-available', '2.0.0'))
    expect(controller.getSnapshot()).toBe(snapshot)
    expect(notifications).toBe(0)

    // 值真的变了才换引用并通知。
    port.emit(withVersion('downloaded', '2.0.0'))
    expect(controller.getSnapshot()).not.toBe(snapshot)
    expect(notifications).toBe(1)
  })

  it('maps check results into structured outcomes', async () => {
    expect((await new UpdaterController(fakeUpdater({ check: async () => state('up-to-date') })).check()).kind).toBe('up-to-date')

    const available = await new UpdaterController(fakeUpdater({ check: async () => withVersion('update-available', '3.1.0') })).check()
    expect(available).toEqual({ kind: 'update-available', version: '3.1.0' })

    const ready = await new UpdaterController(fakeUpdater({ check: async () => withVersion('downloaded', '3.1.0') })).check()
    expect(ready).toEqual({ kind: 'ready-to-install', version: '3.1.0' })

    const readyErr = await new UpdaterController(fakeUpdater({ check: async () => state('downloaded', { errorMessage: 'nope' }) })).check()
    expect(readyErr).toEqual({ kind: 'ready-with-error', message: 'nope' })

    const failed = await new UpdaterController(fakeUpdater({ check: async () => { throw new Error('offline') } })).check()
    expect(failed).toEqual({ kind: 'failed', message: 'offline' })
  })

  it('toggles checkPending around a check', async () => {
    let resolveCheck: (s: UpdateState) => void = () => {}
    const port = fakeUpdater({ check: () => new Promise<UpdateState>(resolve => { resolveCheck = resolve }) })
    const controller = new UpdaterController(port)
    const seen: boolean[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().checkPending))

    const pending = controller.check()
    expect(controller.getSnapshot().checkPending).toBe(true)
    resolveCheck(state('up-to-date'))
    await pending
    expect(controller.getSnapshot().checkPending).toBe(false)
    expect(seen).toContain(true)
  })

  it('refuses a concurrent check', async () => {
    let resolveCheck: (s: UpdateState) => void = () => {}
    const port = fakeUpdater({ check: () => new Promise<UpdateState>(resolve => { resolveCheck = resolve }) })
    const controller = new UpdaterController(port)
    const first = controller.check()
    expect((await controller.check()).kind).toBe('busy')
    resolveCheck(state('up-to-date'))
    await first
  })

  it('maps download results, reading the current error for failures', async () => {
    const downloaded = await new UpdaterController(fakeUpdater({ download: async () => 'download-complete' })).download()
    expect(downloaded).toEqual({ kind: 'downloaded' })

    const quiet = await new UpdaterController(fakeUpdater({ download: async () => 'downloading' })).download()
    expect(quiet).toEqual({ kind: 'quiet' })

    const port = fakeUpdater({ getState: async () => state('error', { errorMessage: 'disk full' }), download: async () => 'failed' })
    const controller = new UpdaterController(port)
    controller.start()
    await Promise.resolve()
    expect(await controller.download()).toEqual({ kind: 'failed', message: 'disk full' })
  })

  it('propagates an install failure to the caller', async () => {
    const controller = new UpdaterController(fakeUpdater({ install: async () => { throw new Error('locked') } }))
    await expect(controller.install()).rejects.toThrow('locked')
  })

  it('no-ops when there is no updater', async () => {
    const controller = new UpdaterController(undefined)
    expect((await controller.check()).kind).toBe('busy')
    expect((await controller.download()).kind).toBe('quiet')
    await expect(controller.install()).resolves.toBeUndefined()
    expect(controller.start()).toBeTypeOf('function')
  })
})
