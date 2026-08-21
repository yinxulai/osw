import { describe, expect, it } from 'vitest'
import { runAttemptQueue } from './attempt-runner'

describe('attempt runner', () => {
  it('continues retryable targets in order and stops on success', async () => {
    const events: string[] = []
    await runAttemptQueue<string, { disposition: 'success' | 'retry' | 'terminal'; statusCode: number }>({
      request: { aborted: false } as never,
      targets: ['first', 'second'],
      attempt: async target => {
        events.push(`attempt:${target}`)
        return target === 'first'
          ? { disposition: 'retry', statusCode: 503 }
          : { disposition: 'success', statusCode: 200 }
      },
      onRetry: async target => { events.push(`retry:${target}`) },
      onSuccess: async target => { events.push(`success:${target}`) },
      onTerminal: async target => { events.push(`terminal:${target}`) },
      onError: async () => true,
      onCancelled: async () => { events.push('cancelled') },
      onExhausted: async () => { events.push('exhausted') },
    })

    expect(events).toEqual(['attempt:first', 'retry:first', 'attempt:second', 'success:second'])
  })

  it('stops when an error handler declines continuation', async () => {
    const events: string[] = []
    await runAttemptQueue<string, { disposition: 'success' | 'retry' | 'terminal'; statusCode: number }>({
      request: { aborted: false } as never,
      targets: ['only'],
      attempt: async () => { throw new Error('failed') },
      onRetry: async () => undefined,
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
})
