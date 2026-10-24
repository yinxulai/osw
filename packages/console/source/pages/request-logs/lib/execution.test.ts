// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestAttempt, LiveRequestCandidate } from '@common/schemas'
import { executionSnapshotOf, isRequestExecuting } from './execution'

/*
 * 执行中请求的快照换算。
 *
 * 这一层是「实时推送的行」与「落库后的历史行」之间唯一的口径对齐点：同一条请求在落定的
 * 那一瞬间会从实时行换乘历史行，如果两边的算法不是同一个，界面上的数字会自己跳一下
 * （TPS 从 42 变成 38，客户端字节从 2 KB 变成 6 KB）。所以这里的每个取值都必须能对上
 * 落库那条路径的说法：
 *
 *  - 尝试级事实取**最后一次尝试**（故障转移交付即停）；
 *  - **「已收到字节」只算最后一次尝试**——被放弃的尝试一个字节都没交给客户端；
 *  - 速度调 `@common/metrics` 的同一个公式，不在界面里就地再算一遍；
 *  - 「没有速度」返回 `null`，不返回 0。
 */

function attemptOf(overrides: Partial<LiveRequestAttempt> = {}): LiveRequestAttempt {
  return {
    index: 0,
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    endpointProtocol: 'openai-responses',
    url: 'https://example.com/v1/responses',
    state: 'streaming',
    httpStatus: 200,
    upstreamTransport: 'http-stream',
    requestBytes: 1_024,
    requestRewriteRuleNames: [],
    upstreamBytes: 4_096,
    downstreamBytes: 2_048,
    chunkCount: 3,
    chunkPreview: 'data: {"delta":"hi"}',
    ttftMilliseconds: 120,
    inputTokens: 12,
    outputTokens: 42,
    errorMessage: null,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  }
}

function candidateOf(overrides: Partial<LiveRequestCandidate> = {}): LiveRequestCandidate {
  return {
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    ...overrides,
  }
}

function liveOf(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_live',
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
    candidates: [candidateOf()],
    attempts: [attemptOf()],
    events: [],
    ...overrides,
  }
}

describe('是否仍在执行', () => {
  it('台账里没有这条请求就不算执行中（可能是别的页签的历史行）', () => {
    expect(isRequestExecuting(undefined, 'pending')).toBe(false)
    expect(isRequestExecuting(undefined, 'success')).toBe(false)
    expect(isRequestExecuting(undefined, undefined)).toBe(false)
  })

  it('台账说还在跑就算执行中', () => {
    expect(isRequestExecuting(liveOf(), undefined)).toBe(true)
  })

  it('台账已经落定，但库里那一行还停在 pending，仍算执行中', () => {
    // 落库与列表轮询之间有最多 1.5s 的差。挑「还没结束」是因为另一边会把一条刚跑完的
    // 请求降级成几乎全空的详情卡。
    expect(isRequestExecuting(liveOf({ status: 'success', endedAt: 9_999 }), 'pending')).toBe(true)
  })

  it('台账与库里都说完成，就是历史行', () => {
    expect(isRequestExecuting(liveOf({ status: 'success', endedAt: 9_999 }), 'success')).toBe(false)
    expect(isRequestExecuting(liveOf({ status: 'failed', endedAt: 9_999 }), 'failed')).toBe(false)
  })

  it('库里的状态没出现在这一页/这次筛选时，只看台账', () => {
    expect(isRequestExecuting(liveOf({ status: 'failed', endedAt: 9_999 }), undefined)).toBe(false)
  })
})

describe('尝试的选取', () => {
  it('一次尝试都没有时 attempt 为 null，各项取值走空值', () => {
    const snapshot = executionSnapshotOf(liveOf({ attempts: [] }), 2_000)

    expect(snapshot.attempt).toBeNull()
    expect(snapshot.attemptCount).toBe(0)
    expect(snapshot.ttftMilliseconds).toBeNull()
    expect(snapshot.inputTokens).toBeNull()
    expect(snapshot.outputTokens).toBeNull()
    expect(snapshot.outputTokensPerSecond).toBeNull()
    expect(snapshot.receivedBytes).toBe(0)
    expect(snapshot.chunkPreview).toBeNull()
  })

  it('故障转移后取最后一次尝试的尝试级事实（被放弃的那次不再露出来）', () => {
    const snapshot = executionSnapshotOf(liveOf({
      candidates: [candidateOf({ providerModelName: 'model-one' }), candidateOf({ providerModelName: 'model-two' })],
      attempts: [
        attemptOf({ index: 0, state: 'failed', httpStatus: 500, outputTokens: null, ttftMilliseconds: null, downstreamBytes: 0 }),
        attemptOf({ index: 1, providerModelName: 'model-two', outputTokens: 42, ttftMilliseconds: 200, downstreamBytes: 2_048 }),
      ],
    }), 2_000)

    expect(snapshot.attempt?.index).toBe(1)
    expect(snapshot.attemptCount).toBe(2)
    expect(snapshot.ttftMilliseconds).toBe(200)
    expect(snapshot.outputTokens).toBe(42)
  })

  it('「已收到字节」只算最后一次尝试，不把被放弃的那次加起来', () => {
    const snapshot = executionSnapshotOf(liveOf({
      attempts: [
        attemptOf({ index: 0, state: 'failed', downstreamBytes: 5_000 }),
        attemptOf({ index: 1, downstreamBytes: 2_048 }),
      ],
    }), 2_000)

    // 故障转移期间被放弃的响应一个字节都没交给客户端。
    expect(snapshot.receivedBytes).toBe(2_048)
  })
})

describe('耗时与速度', () => {
  it('请求还没结束时，耗时按 now 走（界面据此自己走秒）', () => {
    const snapshot = executionSnapshotOf(liveOf({ startedAt: 1_000, endedAt: null }), 2_500)

    expect(snapshot.elapsedMilliseconds).toBe(1_500)
  })

  it('已落定时耗时是它的总耗时，不再随 now 变', () => {
    const snapshot = executionSnapshotOf(liveOf({ startedAt: 1_000, endedAt: 3_000 }), 99_999)

    expect(snapshot.elapsedMilliseconds).toBe(2_000)
  })

  it('速度 = 输出 Token ÷ 已过去的尝试时长，且含首字等待', () => {
    // 尝试从 1000 开始，now=2000 → 1s；42 token ÷ 1s = 42 tps。
    const snapshot = executionSnapshotOf(liveOf({ attempts: [attemptOf({ startedAt: 1_000, outputTokens: 42 })] }), 2_000)

    expect(snapshot.outputTokensPerSecond).toBe(42)
  })

  it('没有输出 Token 时速度是 null 而不是 0（「没有速度」与「速度为零」是两件事）', () => {
    const snapshot = executionSnapshotOf(liveOf({ attempts: [attemptOf({ outputTokens: null })] }), 2_000)

    expect(snapshot.outputTokensPerSecond).toBeNull()
    expect(snapshot.outputTokens).toBeNull()
  })

  it('时间还没走（now 等于 startedAt）时速度是 null，不除出 Infinity', () => {
    const snapshot = executionSnapshotOf(liveOf({ attempts: [attemptOf({ startedAt: 1_000, outputTokens: 42 })] }), 1_000)

    expect(snapshot.outputTokensPerSecond).toBeNull()
  })

  it('已落定后速度用尝试自己的 endedAt，而不是请求的 endedAt', () => {
    // 尝试 1000→2000（1s，42 token = 42 tps），请求 1000→2500（含首字之外的排队时间）。
    const snapshot = executionSnapshotOf(liveOf({
      startedAt: 1_000,
      endedAt: 2_500,
      attempts: [attemptOf({ startedAt: 1_000, endedAt: 2_000, outputTokens: 42 })],
    }), 9_999)

    expect(snapshot.outputTokensPerSecond).toBe(42)
    expect(snapshot.elapsedMilliseconds).toBe(1_500)
  })
})

describe('下一个落点', () => {
  it('一次尝试都还没开始时指向队列里的第一个候选', () => {
    const snapshot = executionSnapshotOf(liveOf({
      candidates: [candidateOf({ providerModelName: 'first' }), candidateOf({ providerModelName: 'second' })],
      attempts: [],
    }), 1_000)

    expect(snapshot.nextTarget?.providerModelName).toBe('first')
  })

  it('已开始 N 次尝试时指向第 N+1 个候选', () => {
    const snapshot = executionSnapshotOf(liveOf({
      candidates: [candidateOf({ providerModelName: 'first' }), candidateOf({ providerModelName: 'second' })],
      attempts: [attemptOf({ index: 0 })],
    }), 1_000)

    expect(snapshot.nextTarget?.providerModelName).toBe('second')
  })

  it('候选已经试完时为 null（不再硬编一个假落点）', () => {
    const snapshot = executionSnapshotOf(liveOf({
      candidates: [candidateOf()],
      attempts: [attemptOf({ index: 0 })],
    }), 1_000)

    expect(snapshot.nextTarget).toBeNull()
  })

  it('路由还没结论（候选为空）时为 null', () => {
    const snapshot = executionSnapshotOf(liveOf({ candidates: [], attempts: [] }), 1_000)

    expect(snapshot.nextTarget).toBeNull()
  })

  it('候选总数是界面上的分母，取候选列表长度而不是已开始次数', () => {
    const snapshot = executionSnapshotOf(liveOf({
      candidates: [candidateOf(), candidateOf(), candidateOf()],
      attempts: [attemptOf({ index: 0 })],
    }), 1_000)

    expect(snapshot.candidateCount).toBe(3)
    expect(snapshot.attemptCount).toBe(1)
  })
})

describe('分块预览', () => {
  it('取上游最新一个分块的原文', () => {
    const snapshot = executionSnapshotOf(liveOf({ attempts: [attemptOf({ chunkPreview: 'data: {"delta":"bye"}' })] }), 2_000)

    expect(snapshot.chunkPreview).toBe('data: {"delta":"bye"}')
  })

  it('还没吐字节时为 null', () => {
    const snapshot = executionSnapshotOf(liveOf({ attempts: [attemptOf({ chunkPreview: null })] }), 2_000)

    expect(snapshot.chunkPreview).toBeNull()
  })
})
