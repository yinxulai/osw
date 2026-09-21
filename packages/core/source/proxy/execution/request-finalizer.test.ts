import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import type { ExecutionOrigin, UpstreamTarget } from '@server/proxy/contracts'
import type { RequestLogger } from '@server/proxy/observability/logging-types'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import type { AttemptOutcome } from './attempt-outcome'
import { createRequestFinalizer } from './request-finalizer'

/**
 * 统计埋点在这一层关心两件事：**成功时报一条，不成功时不报**；转移与任务计数都只在
 * 「替客户端处理的请求」上发生。
 *
 * 所以这里 mock 掉遥测入口，直接看它被怎么调用（连同属性）；顺带 mock 掉健康度写入——
 * 那是另一个模块的事，它的真实实现要碰数据库，而这条用例不该为此起一个库。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

vi.mock('@server/proxy/upstream/health', () => ({
  markProviderSuccess: vi.fn(async () => {}),
  markProviderModelSuccess: vi.fn(async () => {}),
  markProviderFailure: vi.fn(async () => {}),
  markProviderModelFailure: vi.fn(async () => {}),
}))

const target = {
  providerId: 'provider-1',
  providerModelId: 'model-1',
  providerName: 'provider',
  providerModelName: 'model',
} as unknown as UpstreamTarget

/** 第二、第三个候选：转移要有一个「下一个」才算转移。 */
const secondTarget = { ...target, providerId: 'provider-2', providerModelId: 'model-2' }
const thirdTarget = { ...target, providerId: 'provider-3', providerModelId: 'model-3' }
const fourthTarget = { ...target, providerId: 'provider-4', providerModelId: 'model-4' }

const context = {
  requestId: 'request-1',
  logicalModelId: null,
  clientProtocol: 'openai-completions',
  method: 'POST',
  path: '/v1/chat/completions',
} as unknown as RequestContext

function createLogger(): RequestLogger {
  return {
    requestContentId: null,
    finalizeRequestLog: vi.fn(async () => {}),
    finalizeRequestContent: vi.fn(async () => {}),
    finalizeLocalErrorContent: vi.fn(async () => {}),
  }
}

function createFinalizer(targets: readonly UpstreamTarget[] = [target], origin: ExecutionOrigin = 'client') {
  return createRequestFinalizer({
    context,
    targets,
    response: {
      headersSent: false,
      headers: () => ({}),
      fail: vi.fn(() => ''),
      destroy: vi.fn(),
    } as unknown as ProxyResponse,
    requestLogger: createLogger(),
    captureRequestContent: false,
    startedAt: Date.now(),
    origin,
  })
}

beforeEach(() => {
  reported.length = 0
})

describe('request_completed reporting', () => {
  it('reports once when a request is forwarded successfully', async () => {
    const outcome: AttemptOutcome = { disposition: 'success', statusCode: 200, durationMilliseconds: 12 }

    await createFinalizer().onSuccess(target, outcome, 0)

    // 一条成功事件，不带任何属性——要数的就是这个（事件次数）。
    expect(reported).toEqual([{ name: 'request_completed' }])
  })

  it('stays silent when the same hook is called without a successful disposition', async () => {
    // `onSuccess` 也会被「上游回了非 2xx」这类结局用到，那时不能算处理成功。
    const outcome: AttemptOutcome = { disposition: 'terminal', statusCode: 503, durationMilliseconds: 12 }

    await createFinalizer().onSuccess(target, outcome, 0)

    expect(reported).toEqual([])
  })

  it('does not count a failed or cancelled request', async () => {
    const finalizer = createFinalizer()
    const outcome: AttemptOutcome = { disposition: 'terminal', statusCode: 503, durationMilliseconds: 12 }

    await finalizer.onTerminal(target, outcome, 0)
    await finalizer.onCancelled(target, 0)

    expect(reported).toEqual([])
  })

  it('does not count an internal execution as a processed task', async () => {
    // 连接测试、工作流里的模型节点走的也是这条收尾，但它们不是替客户端处理的任务。
    const outcome: AttemptOutcome = { disposition: 'success', statusCode: 200, durationMilliseconds: 12 }

    await createFinalizer([target], 'internal').onSuccess(target, outcome, 0)

    expect(reported).toEqual([])
  })
})

describe('failover_happened reporting', () => {
  async function failover(targets: readonly UpstreamTarget[], attemptIndex: number): Promise<void> {
    const outcome: AttemptOutcome = { disposition: 'failover', statusCode: 503, durationMilliseconds: 12 }
    await createFinalizer(targets).onFailover(targets[attemptIndex], outcome, attemptIndex)
  }

  it('reports the attempt the request is moving on to, bucketed', async () => {
    await failover([target, secondTarget], 0)
    expect(reported).toEqual([{ name: 'failover_happened', attempts: '2' }])

    reported.length = 0
    await failover([target, secondTarget, thirdTarget], 1)
    expect(reported).toEqual([{ name: 'failover_happened', attempts: '3' }])

    reported.length = 0
    await failover([target, secondTarget, thirdTarget, fourthTarget], 2)
    // 四层以上合并成一桶：精确值对产品决策没有额外信息量，却是更细的行为指纹。
    expect(reported).toEqual([{ name: 'failover_happened', attempts: '4+' }])
  })

  it('does not call the last candidate failure a failover', async () => {
    // 没有下一个候选时走的是「候选耗尽」，那里没有可转移的对象。
    await failover([target], 0)

    expect(reported).toEqual([])
  })

  it('does not report failover for an internal execution', async () => {
    const outcome: AttemptOutcome = { disposition: 'failover', statusCode: 503, durationMilliseconds: 12 }

    await createFinalizer([target, secondTarget], 'internal').onFailover(target, outcome, 0)

    expect(reported).toEqual([])
  })
})
