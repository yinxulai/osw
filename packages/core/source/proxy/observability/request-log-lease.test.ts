import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, getDataDb, initDatabases } from '@server/database/index'
import { createRequestLog } from '@server/database/request-log-store'
import {
  PENDING_REQUEST_LOG_LEASE_MILLISECONDS,
  startRequestLogLease,
  sweepExpiredPendingRequestLogs,
} from './request-log-lease'

describe('startRequestLogLease', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs onExpire exactly once when the lease elapses', async () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    const lease = startRequestLogLease({
      requestId: 'req_lease',
      startedAt: Date.now(),
      onExpire,
      timeoutMilliseconds: 1_000,
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(onExpire).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onExpire).toHaveBeenCalledTimes(1)

    // 到点之后定时器就该消失，再等多久也不会有第二次收尾。
    await vi.advanceTimersByTimeAsync(PENDING_REQUEST_LOG_LEASE_MILLISECONDS)
    expect(onExpire).toHaveBeenCalledTimes(1)

    lease.dispose()
  })

  it('uses the six-hour lease by default', async () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    const lease = startRequestLogLease({ requestId: 'req_default_lease', startedAt: Date.now(), onExpire })

    await vi.advanceTimersByTimeAsync(PENDING_REQUEST_LOG_LEASE_MILLISECONDS - 1)
    expect(onExpire).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onExpire).toHaveBeenCalledTimes(1)

    lease.dispose()
  })

  it('dispose prevents a pending expiry', async () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    const lease = startRequestLogLease({
      requestId: 'req_disposed',
      startedAt: Date.now(),
      onExpire,
      timeoutMilliseconds: 1_000,
    })

    await vi.advanceTimersByTimeAsync(500)
    lease.dispose()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onExpire).not.toHaveBeenCalled()
  })

  // 宿主返回的定时器句柄不一定带 `unref`。租约是兜底，不能因此让创建请求时抛错。
  it('does not require the timer handle to expose unref', () => {
    const fakeTimer = { ref: vi.fn() }
    vi.stubGlobal('setTimeout', vi.fn(() => fakeTimer))
    vi.stubGlobal('clearTimeout', vi.fn())

    const lease = startRequestLogLease({
      requestId: 'req_no_unref',
      startedAt: Date.now(),
      onExpire: vi.fn(),
      timeoutMilliseconds: 10,
    })

    expect(() => lease.dispose()).not.toThrow()
  })

  it('logs instead of throwing when onExpire rejects', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const lease = startRequestLogLease({
      requestId: 'req_rejecting',
      startedAt: Date.now(),
      onExpire: async () => {
        throw new Error('lease handler exploded')
      },
      timeoutMilliseconds: 10,
    })

    await vi.advanceTimersByTimeAsync(10)

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requestId=req_rejecting'))
    lease.dispose()
  })
})

describe('sweepExpiredPendingRequestLogs', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-request-log-lease-'))
    await initDatabases(temporaryDirectory)
  })

  afterEach(async () => {
    await closeDatabases()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  // 运行期清扫兜住「内存里的租约丢了」：只有创建时间早于租约、且仍是 pending 的行会变。
  it('cancels only stale pending rows and leaves every terminal row untouched', async () => {
    const nowTime = Date.now()
    const log = (id: string, status: 'pending' | 'success') => createRequestLog({
      id,
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      transport: 'http',
      status,
      totalDurationMilliseconds: status === 'success' ? 10 : 0,
    })
    await log('req_stale', 'pending')
    await log('req_fresh', 'pending')
    await log('req_finished', 'success')

    const setCreatedTime = getDataDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?')
    setCreatedTime.run(nowTime - PENDING_REQUEST_LOG_LEASE_MILLISECONDS - 1, 'req_stale')
    setCreatedTime.run(nowTime - 1_000, 'req_fresh')
    // 终态行即便“很旧”，也不能被清扫改写。
    setCreatedTime.run(nowTime - PENDING_REQUEST_LOG_LEASE_MILLISECONDS - 1, 'req_finished')

    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const changed = await sweepExpiredPendingRequestLogs(nowTime)

    expect(changed).toEqual(['req_stale'])
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('count=1 reason=lease-expired'))
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('sampleRequestIds=req_stale'))

    const statusOf = (id: string) => (getDataDb().$client
      .prepare('SELECT status, totalDurationMilliseconds FROM request_logs WHERE id = ?')
      .get(id) as { status: string; totalDurationMilliseconds: number })
    expect(statusOf('req_stale')).toMatchObject({ status: 'cancelled', totalDurationMilliseconds: 0 })
    expect(statusOf('req_fresh')).toMatchObject({ status: 'pending' })
    expect(statusOf('req_finished')).toMatchObject({ status: 'success', totalDurationMilliseconds: 10 })
    // 清扫只改状态，不删除任何一行。
    expect(getDataDb().$client.prepare('SELECT COUNT(*) AS count FROM request_logs').get()).toEqual({ count: 3 })
  })
})
