export interface AttemptRunnerResult {
  disposition: 'success' | 'retry' | 'terminal'
  statusCode: number
  errorResponse?: string | null
}

export interface AttemptRunnerOptions<T, O extends AttemptRunnerResult> {
  signal: AbortSignal
  targets: T[]
  attempt(target: T, attemptIndex: number): Promise<O>
  onSuccess(target: T, outcome: O, attemptIndex: number): Promise<void>
  onTerminal(target: T, outcome: O, attemptIndex: number): Promise<void>
  onRetry(target: T, outcome: O, attemptIndex: number): Promise<void>
  onError(target: T, error: unknown, attemptIndex: number): Promise<boolean>
  onCancelled(target: T, attemptIndex: number): Promise<void>
  onExhausted(lastError: Error | null): Promise<void>
}

export async function runAttemptQueue<T, O extends AttemptRunnerResult>(options: AttemptRunnerOptions<T, O>): Promise<void> {
  let attemptIndex = 0
  let lastError: Error | null = null

  for (const target of options.targets) {
    if (options.signal.aborted) {
      await options.onCancelled(options.targets[0], attemptIndex)
      return
    }

    try {
      const outcome = await options.attempt(target, attemptIndex)
      if (outcome.disposition === 'success') {
        await options.onSuccess(target, outcome, attemptIndex)
        return
      }
      if (outcome.disposition === 'terminal') {
        await options.onTerminal(target, outcome, attemptIndex)
        return
      }
      await options.onRetry(target, outcome, attemptIndex)
      attemptIndex++
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const shouldContinue = await options.onError(target, error, attemptIndex)
      if (!shouldContinue) return
      attemptIndex++
    }
  }

  await options.onExhausted(lastError)
}
