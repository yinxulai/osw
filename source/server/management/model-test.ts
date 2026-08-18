import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { z } from 'zod'
import { listUpstreamModelsByLogicalModel, listProviders } from '../database/store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { findEndpoint } from '../proxy/router'
import { resolveUpstreamUrl, resolveEffectiveUpstreamUrl } from '../proxy/request'
import { createAuthHeaders } from '../proxy/auth'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import type { Protocol } from '@common/schemas'

const TestModelsSchema = z.object({
  logicalModelId: z.string(),
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
})

export interface ModelTestResult {
  modelId: string
  upstreamModelId: string
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

async function handleTestModels(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { logicalModelId, protocol } = TestModelsSchema.parse(body)

  const models = await listUpstreamModelsByLogicalModel(logicalModelId)
  const providers = await listProviders()
  const providerMap = new Map(providers.map(p => [p.id, p]))

  const testableModels = models.filter(m => m.enabled && findEndpoint(m, protocol))

  const results: ModelTestResult[] = []

  for (const model of testableModels) {
    const provider = providerMap.get(model.providerId)
    if (!provider) continue

    const endpoint = findEndpoint(model, protocol)
    if (!endpoint) continue

    const startedAt = Date.now()
    try {
      const targetUrl = resolveUpstreamUrl(
        resolveEffectiveUpstreamUrl(endpoint.upstreamUrl, provider.upstreamUrls, protocol),
      )
      const apiKey = await getSecretStore().get(provider.apiKeyReference)
      if (!apiKey) {
        results.push({
          modelId: model.id,
          upstreamModelId: model.upstreamModelId,
          providerId: provider.id,
          providerName: provider.name,
          success: false,
          durationMilliseconds: Date.now() - startedAt,
          errorMessage: 'API Key 未配置',
        })
        continue
      }

      const testBody = buildTestBody(protocol, model.upstreamModelId)
      const result = await sendTestRequest(targetUrl, protocol, apiKey, endpoint.customAuthHeader ?? null, testBody, provider.timeoutMilliseconds)

      results.push({
        modelId: model.id,
        upstreamModelId: model.upstreamModelId,
        providerId: provider.id,
        providerName: provider.name,
        success: result.success,
        statusCode: result.statusCode,
        durationMilliseconds: Date.now() - startedAt,
        errorMessage: result.errorMessage,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
    } catch (error) {
      results.push({
        modelId: model.id,
        upstreamModelId: model.upstreamModelId,
        providerId: provider.id,
        providerName: provider.name,
        success: false,
        durationMilliseconds: Date.now() - startedAt,
        errorMessage: (error as Error).message,
      })
    }
  }

  sendSuccess(res, { results })
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

interface TestRequestResult {
  success: boolean
  statusCode?: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
}

function sendTestRequest(targetUrl: string, protocol: Protocol, apiKey: string, customAuthHeader: string | null, body: string, timeout: number): Promise<TestRequestResult> {
  return new Promise(resolve => {
    const parsed = new URL(targetUrl)
    const isHttps = parsed.protocol === 'https:'
    const transport = isHttps ? https : http

    const authHeaders = createAuthHeaders(protocol, apiKey, customAuthHeader)
    const headers = {
      ...authHeaders,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
      timeout,
    }

    const req = transport.request(options, res => {
      const statusCode = res.statusCode ?? 0
      let data = ''
      res.on('data', chunk => { data += chunk.toString('utf8') })
      res.on('end', () => {
        const success = statusCode >= 200 && statusCode < 400
        let inputTokens: number | null = null
        let outputTokens: number | null = null

        if (success && data) {
          try {
            const json = JSON.parse(data)
            if (json.usage) {
              inputTokens = json.usage.prompt_tokens ?? json.usage.input_tokens ?? null
              outputTokens = json.usage.completion_tokens ?? json.usage.output_tokens ?? null
            }
          } catch {
            // ignore
          }
        }

        resolve({
          success,
          statusCode,
          errorMessage: success ? undefined : `HTTP ${statusCode}`,
          inputTokens,
          outputTokens,
        })
      })
    })

    req.on('error', err => {
      resolve({
        success: false,
        errorMessage: err.message,
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error('请求超时'))
    })

    req.write(body)
    req.end()
  })
}
