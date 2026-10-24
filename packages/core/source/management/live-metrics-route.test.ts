import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_METRICS_STREAM_PROTOCOL_VERSION, type LiveMetricsStreamMessage } from '@common/live-metrics-stream'
import { closeDatabases, initDatabases } from '../database'
import { requestLogRoutes } from './routes/observability/request-logs'

/**
 * 实时指标推送通道（`POST /api/live-metrics/stream`）与历史日志清理（`POST /api/request-log/prune`）。
 *
 * 这两条合在一起有个共同点：**它们都不该结束**。
 *
 *   - 指标流是一条 NDJSON 长响应，故意不 `end()`：提前返回会让一条活了几分钟的连接在访问
 *     日志里被记成几毫秒就结束了，界面也拿不到后续帧。
 *   - 清理接口是少数会**真的删掉用户数据**的端点，所以它的返回值必须是真实删除行数，
 *     而不是「收到了请求」。
 *
 * 传输骨架（合流、心跳、背压）由 `realtime/stream-fanout.test.ts` 覆盖，这里只验路由这一层
 * 的头、首帧与收尾。
 */

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-metrics-route-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

interface HeaderTarget { headers: Record<string, string> }

interface StreamingResponseHandle {
  response: ServerResponse
  written: string[]
  close: () => void
}

/** 一条长响应：`write` 记账、`once('close')` 由用例手动触发，好让处理器能走到收尾那一步。 */
function streamingResponse(): StreamingResponseHandle {
  const written: string[] = []
  const closeListeners = new Set<() => void>()
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writableEnded: false,
    destroyed: false,
    end: vi.fn(),
    destroy: vi.fn(),
    setHeader(this: HeaderTarget, name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    },
    write: (payload: string) => {
      written.push(payload)
      return true
    },
    on: () => response,
    off: () => response,
    once: (event: string, listener: () => void) => {
      if (event === 'close') closeListeners.add(listener)
      return response
    },
  } as unknown as ServerResponse
  return {
    response,
    written,
    close: () => {
      for (const listener of [...closeListeners]) listener()
    },
  }
}

describe('live metrics stream route', () => {
  it('opens an NDJSON stream and pushes a snapshot frame before any heartbeats', async () => {
    const { response, written, close } = streamingResponse()

    const handled = requestLogRoutes.invoke('/api/live-metrics/stream', response, {})

    expect(response.statusCode).toBe(200)
    expect((response as unknown as { headers: Record<string, string> }).headers['content-type']).toBe('application/x-ndjson; charset=utf-8')
    // 这条流不参与任何缓存：指标是此刻的数。
    expect((response as unknown as { headers: Record<string, string> }).headers['cache-control']).toBe('no-store, no-transform')

    // 首帧必须**同步**就有：新连上来的客户端不该为了第一帧再等一个节拍。
    expect(written).toHaveLength(1)
    expect(written[0].endsWith('\n')).toBe(true)
    const frame = JSON.parse(written[0].trimEnd()) as LiveMetricsStreamMessage
    expect(frame.protocolVersion).toBe(LIVE_METRICS_STREAM_PROTOCOL_VERSION)
    expect(frame.type).toBe('snapshot')

    // 还没结束：连接是长活的。
    expect(response.end).not.toHaveBeenCalled()

    // 对端关掉之后处理器才收尾，把订阅摘掉。
    close()
    await expect(handled).resolves.toBeUndefined()
  })

  it('sends the zero snapshot rather than nothing when no metrics have been computed yet', async () => {
    const { response, written, close } = streamingResponse()

    const handled = requestLogRoutes.invoke('/api/live-metrics/stream', response, {})
    const frame = JSON.parse(written[0].trimEnd()) as Extract<LiveMetricsStreamMessage, { type: 'snapshot' }>

    // 形状永远成立：要么是真实指标，要么是零值。类型上不允许「没有 metrics 字段」。
    expect(frame.metrics).toMatchObject({ activeRequests: expect.any(Number) })
    expect(frame.metrics.liveTps === null || typeof frame.metrics.liveTps === 'number').toBe(true)

    close()
    await handled
  })
})

describe('request log prune route', () => {
  it('reports zero deletions when nothing is old enough', async () => {
    const response = await requestLogRoutes.request('/api/request-log/prune', {})

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ success: true, data: { deletedLogs: 0, deletedContents: 0 } })
  })

  it('treats a missing retention window as "keep everything" instead of deleting everything', async () => {
    const response = await requestLogRoutes.request('/api/request-log/prune', {
      requestLogRetentionDays: 0,
      contentRetentionDays: 0,
    })

    // 0 天 = 永久保留，不是「删掉所有东西」。这一条是清理功能最危险的误读方向。
    expect(response.json()).toEqual({ success: true, data: { deletedLogs: 0, deletedContents: 0 } })
  })

  it('rejects a negative retention window', async () => {
    await expect(requestLogRoutes.request('/api/request-log/prune', { requestLogRetentionDays: -1 })).rejects.toThrow()
  })
})
