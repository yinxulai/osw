import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logRoutes } from './logs'
import { clearLogs, installLogCapture, listLogs } from './log-buffer'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as import('node:http').ServerResponse
}

function responseData(response: import('node:http').ServerResponse): Record<string, unknown> {
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

  it('lists, exports and clears the in-memory log buffer', () => {
    console.info('hello from logs route test')

    const listRes = mockResponse()
    logRoutes['/api/logs/list']({} as import('node:http').IncomingMessage, listRes, { limit: 50 })
    const listPayload = responseData(listRes) as { data: { logs: Array<{ message: string }>; latestId: number } }
    expect(listPayload.data.logs.length).toBeGreaterThan(0)
    expect(listPayload.data.logs[0].message).toContain('hello from logs route test')

    const exportRes = mockResponse()
    logRoutes['/api/logs/export']({} as import('node:http').IncomingMessage, exportRes, {})
    const exportPayload = responseData(exportRes) as { data: { content: string } }
    expect(exportPayload.data.content).toContain('hello from logs route test')

    const clearRes = mockResponse()
    logRoutes['/api/logs/clear']({} as import('node:http').IncomingMessage, clearRes, {})
    expect(responseData(clearRes)).toEqual({ success: true, data: { cleared: true } })
    expect(listLogs()).toEqual([])
  })
})
