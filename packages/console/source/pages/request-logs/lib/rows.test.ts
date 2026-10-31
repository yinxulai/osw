import { describe, expect, it } from 'vitest'
import type { LiveRequest, RequestLogEntry } from '@common/schemas'
import { buildRequestLogRows } from './rows'

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

describe('buildRequestLogRows', () => {
  it('renders a row from the ledger while the request is still running', () => {
    const rows = buildRequestLogRows({ logs: [log()], liveRequests: [live()], injectLive: false })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('execution')
  })

  it('hands the row back to the log view once both sides have settled', () => {
    const rows = buildRequestLogRows({
      logs: [log({ status: 'success' })],
      liveRequests: [live({ status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: false,
    })

    expect(rows[0]?.kind).toBe('log')
  })

  it('stays on the ledger while the database row still says pending', () => {
    // 落库与列表轮询之间有最多 1.5s 的差：这段时间库里那一行还说「进行中」，
    // 而界面必须挑一边——挑「还没结束」，否则用户会看见一条刚跑完的请求
    // 塌成一张几乎全空的详情卡，然后下一秒又跳回来。
    const rows = buildRequestLogRows({
      logs: [log({ status: 'pending' })],
      liveRequests: [live({ status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: false,
    })

    expect(rows[0]?.kind).toBe('execution')
  })

  it('leaves rows alone when the ledger has never heard of them', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_old', status: 'success' })],
      liveRequests: [live({ id: 'req_new' })],
      injectLive: false,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('log')
  })

  it('prepends in-flight requests that have no row on this page', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_old', status: 'success' })],
      liveRequests: [live({ id: 'req_new' })],
      injectLive: true,
    })

    expect(rows.map(row => row.kind)).toEqual(['execution', 'log'])
    expect(rows[0]?.kind === 'execution' && rows[0].live.id).toBe('req_new')
  })

  it('does not invent rows while a filter or a later page is in effect', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_old', status: 'success' })],
      liveRequests: [live({ id: 'req_new' })],
      injectLive: false,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('log')
  })

  it('never shows the same request twice', () => {
    const rows = buildRequestLogRows({
      logs: [log({ id: 'req_x' })],
      liveRequests: [live({ id: 'req_x' })],
      injectLive: true,
    })

    expect(rows).toHaveLength(1)
  })

  it('keeps the long-settled ledger entries out of the injected batch', () => {
    // 台账里会留一段时间的已落定记录（60s），保留窗口之外的它们已经被库里的行代表了，不能再补一遍。
    const rows = buildRequestLogRows({
      logs: [],
      liveRequests: [live({ id: 'req_done', status: 'failed', phase: 'settled', endedAt: 2_000 })],
      injectLive: true,
    })

    expect(rows).toEqual([])
  })

  it('honours a caller that wants to hold a settled row a bit longer', () => {
    // 落定后的保留窗口（见 `live-hold.ts`）：库里的行已经说结束了，但调用方还想让实时形态再留一会儿
    // ——那把五格尺子读的是「走到了哪一步」，而这句话恰恰要等它跑完才有人细看。
    const rows = buildRequestLogRows({
      logs: [log({ status: 'success' })],
      liveRequests: [live({ status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: false,
      keepLive: () => true,
    })

    expect(rows[0]?.kind).toBe('execution')
  })

  it('keeps injecting a request that the caller still wants to hold', () => {
    // 库里根本没有它（日志采集关掉、写入失败、或轮询还没回来），而调用方说「还该用实时形态」
    // ——通常是「用户正展开着，别去动他手里的东西」（见 `live-hold.ts`）。
    // 这时补入是**唯一**的显示途径：把它挡在门外，请求一落定整行就消失，
    // 连带用户正展开的详情一起。
    const rows = buildRequestLogRows({
      logs: [],
      liveRequests: [live({ id: 'req_done', status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: true,
      keepLive: () => true,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('execution')
  })

  it('drops a settled request it can no longer show anywhere', () => {
    // 落定过、库里的行没来、调用方也不再留着它：没有可显示的一边，整行消失。
    const rows = buildRequestLogRows({
      logs: [],
      liveRequests: [live({ id: 'req_done', status: 'success', phase: 'settled', endedAt: 2_000 })],
      injectLive: true,
      keepLive: () => false,
    })

    expect(rows).toEqual([])
  })
})
