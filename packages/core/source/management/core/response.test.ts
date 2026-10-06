import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../errors'
import { mockResponse } from '../test-support'
import { sendError, sendManagementError, sendSuccess } from './response'

/*
 * 管理 API 的响应出口。
 *
 * 两条容易踩的边界：**已结束的响应不再写**（否则 Node 会抛 ERR_STREAM_WRITE_AFTER_END，
 * 把一次已经答过的请求变成 500），以及**不可暴露的错误不外泄原文**
 * （`expose: false` 的内错必须换成兜底文案，否则堆栈与内部信息会进响应体）。
 */

function body(res: ReturnType<typeof mockResponse>): unknown {
  const end = res.end as ReturnType<typeof vi.fn>
  return JSON.parse(end.mock.calls[0][0] as string)
}

describe('sendSuccess', () => {
  it('返回 200 + application/json + { success: true, data }', () => {
    const res = mockResponse()

    sendSuccess(res, { id: 'lm_primary' })

    expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(body(res)).toEqual({ success: true, data: { id: 'lm_primary' } })
  })

  it('data 是 undefined 时字段仍在（客户端可以统一按 data 取值）', () => {
    const res = mockResponse()

    sendSuccess(res, undefined)

    expect(body(res)).toEqual({ success: true })
  })
})

describe('sendError', () => {
  it('默认 400，正文是 { success: false, errorCode, errorMessage }', () => {
    const res = mockResponse()

    sendError(res, 'INVALID_JSON', 'Request body is not valid JSON')

    expect(res.statusCode).toBe(400)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(body(res)).toEqual({ success: false, errorCode: 'INVALID_JSON', errorMessage: 'Request body is not valid JSON' })
  })

  it('可以指定状态码', () => {
    const res = mockResponse()

    sendError(res, 'NOT_FOUND', 'API path not found: /api/nope', 404)

    expect(res.statusCode).toBe(404)
  })

  it('只有传了 errorParams 才写进正文（空对象也算传了）', () => {
    const without = mockResponse()
    sendError(without, 'NOT_FOUND', 'not found', 404)
    expect(body(without)).not.toHaveProperty('errorParams')

    const withParams = mockResponse()
    sendError(withParams, 'NOT_FOUND', 'not found', 404, { path: '/api/nope' })
    expect(body(withParams)).toEqual({
      success: false,
      errorCode: 'NOT_FOUND',
      errorMessage: 'not found',
      errorParams: { path: '/api/nope' },
    })
  })

  it('响应已经写完时直接返回，不碰任何字段', () => {
    const res = mockResponse({ writableEnded: true })

    sendError(res, 'INTERNAL_ERROR', 'boom', 500)

    expect(res.statusCode).toBe(0)
    expect(res.setHeader).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('错误文案保持英文原文，不做本地化（界面按 errorCode 自己翻译）', () => {
    const res = mockResponse()

    sendError(res, 'UPSTREAM_ERROR', 'The upstream returned 502')

    expect((body(res) as { errorMessage: string }).errorMessage).toBe('The upstream returned 502')
  })
})

describe('sendManagementError', () => {
  it('暴露的 AppError 用原文与自带状态码，并把 details 里可序列化的字段带出去', () => {
    const res = mockResponse()

    sendManagementError(res, new AppError('RESOURCE_NOT_FOUND', 404, 'Logical model lm_x not found', { details: { id: 'lm_x' } }))

    expect(res.statusCode).toBe(404)
    expect(body(res)).toEqual({
      success: false,
      errorCode: 'RESOURCE_NOT_FOUND',
      errorMessage: 'Logical model lm_x not found',
      errorParams: { id: 'lm_x' },
    })
  })

  it('不可暴露的错误换成兜底文案，且不泄漏 details', () => {
    const res = mockResponse()

    sendManagementError(res, new AppError('INTERNAL_ERROR', 500, 'SQLITE_CONSTRAINT: UNIQUE failed', {
      expose: false,
      details: { sql: 'insert into providers ...' },
    }))

    expect(res.statusCode).toBe(500)
    expect(body(res)).toEqual({ success: false, errorCode: 'INTERNAL_ERROR', errorMessage: 'Internal server error' })
  })

  it('非 AppError 走 normalizeError，落到 500 兜底', () => {
    const res = mockResponse()

    sendManagementError(res, new Error('raw failure'))

    expect(res.statusCode).toBe(500)
    expect(body(res)).toEqual({ success: false, errorCode: 'INTERNAL_ERROR', errorMessage: 'Internal server error' })
  })

  it('仅值可序列化的 details 字段进 errorParams（嵌套结构不外泄）', () => {
    const res = mockResponse()

    sendManagementError(res, new AppError('DUPLICATE_RESOURCE', 409, 'Logical model lm_x already exists', {
      details: { modelId: 'lm_x', count: 2, nested: { secret: true }, list: [1, 2] },
    }))

    expect(body(res)).toEqual({
      success: false,
      errorCode: 'DUPLICATE_RESOURCE',
      errorMessage: 'Logical model lm_x already exists',
      errorParams: { modelId: 'lm_x', count: 2 },
    })
  })

  it('details 里没有任何可序列化字段时不写 errorParams', () => {
    const res = mockResponse()

    sendManagementError(res, new AppError('RESOURCE_NOT_FOUND', 404, 'not found', { details: { nested: { a: 1 } } }))

    expect(body(res)).not.toHaveProperty('errorParams')
  })
})
