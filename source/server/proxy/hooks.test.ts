import { describe, expect, it } from 'vitest'
import { createRequestContext } from './request-context'
import type { ProxyObservationHooks } from './hooks'

describe('proxy observation hooks', () => {
  it('exposes a protocol-neutral request context contract', async () => {
    const calls: string[] = []
    const hooks: ProxyObservationHooks = {
      onRequestStarted: context => {
        calls.push(`${context.requestId}:${context.clientProtocol}`)
      },
    }
    await hooks.onRequestStarted?.(createRequestContext({
      requestId: 'req_test',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      method: 'POST',
      path: '/v1/responses',
      requestBody: Buffer.from('{}'),
      request: {} as never,
    }))

    expect(calls).toEqual(['req_test:openai-responses'])
  })
})
