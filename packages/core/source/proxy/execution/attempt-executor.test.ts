import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveRequestHandle } from '@server/proxy/observability/live-request-store'
import type { RequestLogger } from '@server/proxy/observability/logging-types'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { createRequestContext } from '@server/proxy/request/request-context'
import { executeProxyRequest } from './attempt-executor'

const { runAttempts } = vi.hoisted(() => ({ runAttempts: vi.fn() }))

vi.mock('@server/proxy/execution/attempt-runner', () => ({ runAttempts }))

beforeEach(() => {
  runAttempts.mockReset()
})

/**
 * 执行器的兜底不是为了替代六类结局，而是为了覆盖「六类结局都没来得及跑」：
 * 尝试循环或某个收尾处理器自己抛错。这条用例让 `runAttempts` 直接失败，
 * 断言请求行仍然被写成终态、台账仍然落定，而异常继续向上抛。
 */
function createLogger(initiallyFinalized = false): { logger: RequestLogger; finalizeRequestLog: ReturnType<typeof vi.fn> } {
  let finalized = initiallyFinalized
  const finalizeRequestLog = vi.fn(async () => {
    finalized = true
  })
  return {
    logger: {
      requestContentId: null,
      updateRequest: vi.fn(async () => {}),
      finalizeRequestLog,
      finalizeRequestContent: vi.fn(async () => {}),
      finalizeLocalErrorContent: vi.fn(async () => {}),
      isFinalized: () => finalized,
    },
    finalizeRequestLog,
  }
}

function executeWith(signal: AbortSignal, initiallyFinalized = false) {
  const { logger, finalizeRequestLog } = createLogger(initiallyFinalized)
  const session = {
    startedAt: 1_700_000_000_000,
    settings: { captureRequestLogs: true, captureRequestContent: false, idleTimeoutMilliseconds: 1_000 },
    logger,
  }
  const live = { settle: vi.fn() } as unknown as LiveRequestHandle
  const execution = executeProxyRequest({
    context: createRequestContext({
      requestId: 'req_executor_backstop',
      logicalModelId: 'model_default',
      clientProtocol: 'openai-completions',
      method: 'POST',
      path: '/v1/chat/completions',
      requestBody: Buffer.alloc(0),
      signal,
    }),
    targets: [],
    response: { headersSent: false } as ProxyResponse,
    session,
    origin: 'client',
    live,
  })
  return { execution, finalizeRequestLog, live, session }
}

describe('executeProxyRequest terminal backstop', () => {
  it('finalizes the request as failed when the attempt loop throws', async () => {
    runAttempts.mockRejectedValueOnce(new Error('finalizer exploded'))
    const { execution, finalizeRequestLog, live, session } = executeWith(new AbortController().signal)

    await expect(execution).rejects.toThrow('finalizer exploded')

    expect(finalizeRequestLog).toHaveBeenCalledWith('failed', session.startedAt)
    expect(live.settle).toHaveBeenCalledWith('failed', 'request.failed', 'error')
  })

  it('finalizes as cancelled when the request signal was aborted', async () => {
    runAttempts.mockRejectedValueOnce(new Error('cancelled midway'))
    const controller = new AbortController()
    controller.abort()
    const { execution, finalizeRequestLog, live, session } = executeWith(controller.signal)

    await expect(execution).rejects.toThrow('cancelled midway')

    expect(finalizeRequestLog).toHaveBeenCalledWith('cancelled', session.startedAt)
    expect(live.settle).toHaveBeenCalledWith('cancelled', 'request.cancelled', 'warn')
  })

  it('leaves an already-finalized request alone', async () => {
    // 正常路径：六类结局之一已经写完了终态，兜底不该再写一次。
    runAttempts.mockResolvedValueOnce(undefined)
    const { execution, finalizeRequestLog } = executeWith(new AbortController().signal, true)

    await execution

    expect(finalizeRequestLog).not.toHaveBeenCalled()
  })
})
