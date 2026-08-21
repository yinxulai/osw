import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderEndpoints, listProviderModels, listProviders } from '../database/store'
import { generateId } from '@common/utils'
import { findEndpoint } from '../proxy/router'
import { executeProxyRequest } from '../proxy/handler'
import { createRequestContext } from '../proxy/request-context'
import { BufferedProxyResponse } from '../proxy/proxy-response'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import type { Protocol } from '@common/schemas'

const TestModelsSchema = z.object({
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
  providerIds: z.array(z.string()).optional(),
  modelIds: z.array(z.string()).optional(),
})

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
}

export const modelTestRoutes: Record<string, ManagementHandler> = {
  '/api/model-test/run': handleTestModels,
}

async function handleTestModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { protocol, providerIds, modelIds } = TestModelsSchema.parse(body)
  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  req.once('aborted', onClientAbort)

  const models = (await listProviderModels()).map(model => ({
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      upstreamUrl: endpoint.url ?? '',
      customAuthHeader: null,
      protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }))
  const providers = await listProviders()
  const providerMap = new Map(providers.map(p => [p.id, p]))
  const providerEndpoints = new Map(
    await Promise.all(providers.map(async provider => [
      provider.id,
      new Map((await listProviderEndpoints(provider.id)).filter(endpoint => endpoint.enabled).map(endpoint => [endpoint.protocol, endpoint.url])),
    ] as const)),
  )
  const providerFilter = providerIds ? new Set(providerIds) : null
  const modelFilter = modelIds ? new Set(modelIds) : null

  const testableModels = models.filter(model =>
    model.enabled &&
    findEndpoint(model, protocol) &&
    (!providerFilter || providerFilter.has(model.providerId)) &&
    (!modelFilter || modelFilter.has(model.id)),
  )

  const results: ModelTestResult[] = []

  for (const model of testableModels) {
    if (controller.signal.aborted) return
    const provider = providerMap.get(model.providerId)
    if (!provider) continue

    const endpoint = findEndpoint(model, protocol)
    if (!endpoint) continue

    const startedAt = Date.now()
    try {
      const testBody = buildTestBody(protocol, model.modelName)
      const target = {
        model: {
          ...model,
          endpoints: model.endpoints.map(candidate => ({
            ...candidate,
            upstreamUrl: candidate.upstreamUrl.trim() || providerEndpoints.get(provider.id)?.get(candidate.protocol) || '',
          })),
        },
        provider,
      }
      const response = new BufferedProxyResponse()
      await executeProxyRequest({
        context: createRequestContext({
          requestId: generateId('diagnostic_'),
          logicalModelId: 'diagnostic',
          clientProtocol: protocol,
          method: 'POST',
          path: `/diagnostic/${protocol}`,
          headers: {},
          requestBody: Buffer.from(testBody),
          signal: controller.signal,
        }),
        targets: [target],
        response,
      })
      const success = response.statusCode >= 200 && response.statusCode < 400

      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        success,
        statusCode: response.statusCode || undefined,
        durationMilliseconds: Date.now() - startedAt,
        errorMessage: success ? undefined : `HTTP ${response.statusCode || 502}`,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        success: false,
        durationMilliseconds: Date.now() - startedAt,
        errorMessage: (error as Error).message,
      })
    }
  }

  if (!controller.signal.aborted) sendSuccess(res, { results })
}

function buildTestBody(protocol: Protocol, modelId: string): string {
  switch (protocol) {
    case 'openai-completions':
      return JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
        stream: false,
      })
    case 'openai-responses':
      return JSON.stringify({
        model: modelId,
        input: [{ role: 'user', content: 'Hi' }],
        max_output_tokens: 10,
      })
    case 'anthropic-messages':
      return JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      })
  }
}
