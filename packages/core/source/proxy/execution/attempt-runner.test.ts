import { describe, expect, it } from 'vitest'
import { runAttempts } from '@server/proxy/execution/attempt-runner'

describe('attempt runner', () => {
  it('fails over to targets in order and stops on success', async () => {
    const events: string[] = []
    await runAttempts<string, { disposition: 'success' | 'failover' | 'terminal'; statusCode: number }>({
      signal: new AbortController().signal,
      targets: ['first', 'second'],
      attempt: async target => {
        events.push(`attempt:${target}`)
        return target === 'first'
          ? { disposition: 'failover', statusCode: 503 }
          : { disposition: 'success', statusCode: 200 }
      },
      onFailover: async target => { events.push(`failover:${target}`) },
      onSuccess: async target => { events.push(`success:${target}`) },
      onTerminal: async target => { events.push(`terminal:${target}`) },
      onError: async () => true,
      onCancelled: async () => { events.push('cancelled') },
      onExhausted: async () => { events.push('exhausted') },
    })

    expect(events).toEqual(['attempt:first', 'failover:first', 'attempt:second', 'success:second'])
  })

  it('stops when an error handler declines continuation', async () => {
    const events: string[] = []
    await runAttempts<string, { disposition: 'success' | 'failover' | 'terminal'; statusCode: number }>({
      signal: new AbortController().signal,
      targets: ['only'],
      attempt: async () => { throw new Error('failed') },
      onFailover: async () => undefined,
      onSuccess: async () => undefined,
      onTerminal: async () => undefined,
      onError: async (_target, error) => {
        events.push((error as Error).message)
        return false
      },
      onCancelled: async () => undefined,
      onExhausted: async () => { events.push('exhausted') },
    })

    expect(events).toEqual(['failed'])
  })

  it('attributes cancellation to the candidate that would run next', async () => {
    const controller = new AbortController()
    const cancelled: string[] = []

    await runAttempts<string, { disposition: 'success' | 'failover' | 'terminal'; statusCode: number }>({
      signal: controller.signal,
      targets: ['first', 'second'],
      attempt: async target => {
        if (target === 'first') {
          controller.abort()
          return { disposition: 'failover', statusCode: 503 }
        }
        return { disposition: 'success', statusCode: 200 }
      },
      onFailover: async () => undefined,
      onSuccess: async () => undefined,
      onTerminal: async () => undefined,
      onError: async () => true,
      onCancelled: async target => { cancelled.push(target) },
      onExhausted: async () => undefined,
    })

    expect(cancelled).toEqual(['second'])
  })
})
