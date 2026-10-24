import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logRoutes } from './routes/observability/logs'
import { clearLogs, installLogCapture, listLogs, writeRuntimeLog } from './infrastructure/log-buffer'
import { mockResponse } from './test-support'

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

describe('log routes', () => {
  beforeEach(() => {
    clearLogs()
    installLogCapture()
  })

  afterEach(() => {
    clearLogs()
  })

  it('lists, exports and clears the in-memory log buffer', async () => {
    console.info('hello from logs route test')

    const listRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', listRes, { limit: 50 })
    const listPayload = responseData(listRes) as { data: { logs: Array<{ message: string }>; total: number } }
    expect(listPayload.data.logs.length).toBeGreaterThan(0)
    expect(listPayload.data.logs[0].message).toContain('hello from logs route test')
    expect(listPayload.data.total).toBeGreaterThan(0)

    const exportRes = mockResponse()
    await logRoutes.invoke('/api/logs/export', exportRes)
    const exportPayload = responseData(exportRes) as { data: { content: string } }
    expect(exportPayload.data.content).toContain('hello from logs route test')

    const clearRes = mockResponse()
    await logRoutes.invoke('/api/logs/clear', clearRes)
    expect(responseData(clearRes)).toEqual({ success: true, data: { cleared: true } })
    expect(listLogs()).toEqual([])
  })

  it('paginates logs and applies level/query filters', async () => {
    console.info('alpha marker')
    console.warn('beta marker')

    const listRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', listRes, { limit: 1, offset: 0 })
    const listPayload = responseData(listRes) as { data: { logs: Array<{ level: string }>; total: number } }
    expect(listPayload.data.logs).toHaveLength(1)
    expect(listPayload.data.total).toBeGreaterThanOrEqual(2)

    const levelRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', levelRes, { limit: 50, level: 'warn' })
    const levelPayload = responseData(levelRes) as { data: { logs: Array<{ level: string; message: string }> } }
    expect(levelPayload.data.logs.every(log => log.level === 'warn')).toBe(true)
    expect(levelPayload.data.logs.some(log => log.message.includes('beta marker'))).toBe(true)

    const queryRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', queryRes, { limit: 50, query: 'alpha marker' })
    const queryPayload = responseData(queryRes) as { data: { logs: Array<{ message: string }> } }
    expect(queryPayload.data.logs.every(log => log.message.includes('alpha marker'))).toBe(true)
  })

  it('filters logs by module scope', async () => {
    console.info('[proxy] proxy marker')
    console.info('[database] database marker')

    const scopeRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', scopeRes, { limit: 50, scope: 'proxy' })
    const scopePayload = responseData(scopeRes) as { data: { logs: Array<{ scope: string; message: string }> } }
    expect(scopePayload.data.logs.every(log => log.scope === 'proxy')).toBe(true)
    expect(scopePayload.data.logs.some(log => log.message.includes('proxy marker'))).toBe(true)
    expect(scopePayload.data.logs.some(log => log.message.includes('database marker'))).toBe(false)
  })

  // 宿主（Electron 主进程）的 console 转发走这条路：它自己碰不到数据库，
  // 所以由服务侧按同样的形状写进来（见 `writeRuntimeLog` 与协议里的 `logs.write`）。
  it('writes a forwarded host line verbatim, timestamp included', () => {
    writeRuntimeLog('warn', 'forwarded from host', 1234)

    expect(listLogs()).toEqual([
      expect.objectContaining({ level: 'warn', message: 'forwarded from host', timestamp: 1234, scope: 'other' }),
    ])
  })
})
