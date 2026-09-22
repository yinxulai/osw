import type { ModelTestMode, Protocol } from '@common/schemas'
import type { TranslateParams } from '@common/i18n'
import { request } from './client'

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  mode: ModelTestMode
  success: boolean
  statusCode?: number
  errorMessage?: string
  errorParams?: TranslateParams
  inputTokens?: number | null
  outputTokens?: number | null
  durationMilliseconds: number
  ttftMilliseconds?: number | null
  tokensPerSecond?: number | null
}

export interface ModelTestFilters { providerIds?: string[]; modelIds?: string[] }

export const modelTestApi = {
  run: (protocol: Protocol, mode: ModelTestMode, filters: ModelTestFilters = {}, signal?: AbortSignal) => request<{ results: ModelTestResult[] }>(
    '/model-test/run',
    { protocol, mode, ...filters },
    { signal },
  ),
}

export const developmentApi = {
  seed: () => request<{ inserted: boolean }>('/development/seed'),
}
