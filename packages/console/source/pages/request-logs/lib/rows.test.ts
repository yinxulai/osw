import { describe, expect, it } from 'vitest'
import type { LiveRequest, RequestLogEntry } from '@common/schemas'
import { buildRequestLogRows, shouldUseLiveRow } from './rows'

function live(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_x',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1_000,
    updatedAt: 1_100,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

function log(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: 'req_x',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    status: 'pending',
    totalDurationMilliseconds: 0,
    totalTokens: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    rawUsage: null,
    ttftMilliseconds: null,
    createdTime: 1_000,
    attempts: [],
    ...overrides,
  }
}

describe('shouldUseLiveRow', () => {
  it('uses the log view when the ledger has never heard of the request', () => {
    expect(shouldUseLiveRow(undefined, 'pending', null)).toBe(false)
    expect(shouldUseLiveRow(undefined, 'success', 'req_x')).toBe(false)
  })

  it('uses the live view while the request is still running', () => {
    expect(shouldUseLiveRow(live(), undefined, null)).toBe(true)
  })

  it('hands the row back to the log view once both sides say it settled', () => {
    expect(shouldUseLiveRow(live({ status: 'success', endedAt: 2_000 }), 'success', null)).toBe(false)
    expect(shouldUseLiveRow(live({ status: 'failed', endedAt: 2_000 }), 'failed', null)).toBe(false)
  })

  it('keeps the live view for as long as the user has it expanded', () => {
    // 展开是用户唯一说过的话：他正盯着这一行，把内容换掉等于从他手里抢走。
    expect(shouldUseLiveRow(live({ status: 'failed', endedAt: 2_000 }), 'failed', 'req_x', 2_500)).toBe(true)
  })

  it('does not confuse another row with the expanded one', () => {
    expect(shouldUseLiveRow(live({ status: 'failed', endedAt: 2_000 }), 'failed', 'req_other')).toBe(false)
  })

  it('does not keep a long-settled row on live view forever', () => {
    expect(shouldUseLiveRow(live({ status: 'failed', endedAt: 2_000 }), 'failed', 'req_x', 62_001)).toBe(false)
  })
})

describe('buildRequestLogRows', () => {
  it('renders a row from the ledger while the request is still running', () => {
    const rows = buildRequestLogRows({ logs: [log()], liveRequests: [live()], injectLive: false, expandedId: null })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('execution')
  })

  it('hands the row back to the log view once both sides have settled', () => {
    const rows = buildRequestLogRows({
      logs: [log({ status: 'success' })],
      liveRequests: [live({ status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: false,
      expandedId: null,
    })

    expect(rows[0]?.kind).toBe('log')
  })

  it('keeps the expanded row on the live view even after it settled', () => {
    const now = Date.now()
    // 规则一：已经展开的保持展开状态和展示模式。
    const rows = buildRequestLogRows({
      logs: [log({ status: 'failed' })],
      liveRequests: [live({ status: 'failed', phase: 'settled', endedAt: now - 500 })],
      injectLive: false,
      expandedId: 'req_x',
    })

    expect(rows[0]?.kind).toBe('execution')
  })

  it('stays on the ledger while the database row still says pending', () => {
    // 落库与列表轮询之间有最多 1.5s 的差：这段时间库里那一行还说「进行中」，
    // 而界面必须挑一边——挑「还没结束」，否则用户会看见一条刚跑完的请求
    // 塌成一张几乎全空的详情卡，然后下一秒又跳回来。
    const rows = buildRequestLogRows({
      logs: [log({ status: 'pending' })],
      liveRequests: [live({ status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: false,
      expandedId: null,
    })

    expect(rows[0]?.kind).toBe('execution')
  })

  it('leaves rows alone when the ledger has never heard of them', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_old', status: 'success' })],
      liveRequests: [live({ id: 'req_new' })],
      injectLive: false,
      expandedId: null,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('log')
  })

  it('prepends in-flight requests that have no row on this page', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_old', status: 'success' })],
      liveRequests: [live({ id: 'req_new' })],
      injectLive: true,
      expandedId: null,
    })

    expect(rows.map(row => row.kind)).toEqual(['execution', 'log'])
    expect(rows[0]?.kind === 'execution' && rows[0].live.id).toBe('req_new')
  })

  it('does not invent rows while a filter or a later page is in effect', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_old', status: 'success' })],
      liveRequests: [live({ id: 'req_new' })],
      injectLive: false,
      expandedId: null,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('log')
  })

  it('never shows the same request twice', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_x' })],
      liveRequests: [live({ id: 'req_x' })],
      injectLive: true,
      expandedId: null,
    })

    expect(rows).toHaveLength(1)
  })

  it('does not resurrect a settled request nobody is looking at', () => {
    // 台账会留一段时间的已落定记录（60s），但「库里没有它」不等于「它该出现在这里」：
    // 一条已经跑完、谁也没在看的请求凭空占一行，读起来就是一次跳变。
    const rows = buildRequestLogRows({
      logs: [],
      liveRequests: [live({ id: 'req_done', status: 'failed', phase: 'settled', endedAt: 2_000 })],
      injectLive: true,
      expandedId: null,
    })

    expect(rows).toEqual([])
  })

  it('keeps injecting the request the user is looking at', () => {
    const now = Date.now()
    // 同一份数据、库里没有它，但用户正展开着：那是他的手放在那里，不是内容的问题。
    // 这时补入是**唯一**的显示途径——把它挡在门外，请求一落定整行就消失，连带他正看的详情。
    const rows = buildRequestLogRows({
      logs: [],
      liveRequests: [live({ id: 'req_done', status: 'success', phase: 'settled', endedAt: now - 500 })],
      injectLive: true,
      expandedId: 'req_done',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('execution')
  })
})
