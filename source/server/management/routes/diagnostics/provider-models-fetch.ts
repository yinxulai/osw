import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolSchema, type Protocol } from '@common/schemas'
import { getProvider, listProviderEndpoints } from '@server/database/provider-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { coreNetworkClient } from '@server/infrastructure/network/core-network'
import { createAuthHeaders } from '../../../proxy/upstream/auth'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

export interface FetchedProviderModel {
  id: string
  ownedBy: string | null
  displayName: string | null
  createdTime: number | null
}

export interface FetchProviderModelsResult {
  models: FetchedProviderModel[]
  /** 命中的 models 接口地址 */
  matchedUrl: string
  /** 尝试过的候选地址及失败原因 */
  attempts: { url: string; statusCode?: number; error?: string }[]
}

export const providerModelFetchRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/provider/fetch-models', handleFetchProviderModels)

const FetchProviderModelsSchema = z.object({
  protocol: ProtocolSchema,
  providerId: z.string().optional(),
  /** 临时地址（未保存 provider 或模型级覆盖地址时使用） */
  baseUrl: z.string().trim().min(1).optional(),
  apiKey: z.string().optional(),
}).refine(input => Boolean(input.providerId || input.baseUrl), {
  message: 'providerId 与 baseUrl 至少提供一个',
})

async function handleFetchProviderModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = FetchProviderModelsSchema.parse(body)
  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  req.once('aborted', onClientAbort)

  let baseUrl = input.baseUrl ?? ''
  let apiKey = input.apiKey ?? null
  let timeout = 10000

  if (input.providerId) {
    const provider = await getProvider(input.providerId)
    if (!provider) {
      sendError(res, 'NOT_FOUND', 'Provider 不存在', 404)
      return
    }
    if (!baseUrl) {
      const endpoint = (await listProviderEndpoints(provider.id)).find(candidate => candidate.enabled && candidate.protocol === input.protocol)
      baseUrl = endpoint?.url ?? ''
    }
    if (!apiKey) apiKey = await getSecretStore().get(provider.apiKeyReference)
    timeout = provider.timeoutMilliseconds
  }

  if (!baseUrl) {
    sendError(res, 'VALIDATION_ERROR', '未提供可用的上游地址', 400)
    return
  }

  const candidates = buildModelListUrls(baseUrl)
  const attempts: FetchProviderModelsResult['attempts'] = []

  for (const url of candidates) {
    if (controller.signal.aborted) return
    const result = await fetchModelList(url, input.protocol, apiKey, timeout, controller.signal)
    if (result.ok) {
      sendSuccess(res, { models: result.models, matchedUrl: url, attempts })
      return
    }
    attempts.push({ url, statusCode: result.statusCode, error: result.error })
  }

  const authFailed = attempts.some(attempt => attempt.statusCode === 401 || attempt.statusCode === 403)
  sendError(
    res,
    authFailed ? 'UPSTREAM_AUTH_FAILED' : 'UPSTREAM_MODELS_UNAVAILABLE',
    authFailed
      ? '上游拒绝了认证，请检查 API Key 是否正确'
      : '无法从上游获取模型列表，请检查地址与协议是否匹配，或手动填写模型 ID',
    502,
  )
}

/**
 * 根据用户填写的地址猜测可能的 models 接口地址。
 * 用户可能填 base（https://api.x.com）、带 /v1、甚至完整 chat 地址。
 */
export function buildModelListUrls(baseUrl: string): string[] {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return []
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return []

  const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean)

  // 去掉末尾的已知资源段，得到 base 路径
  const resourceSegments = new Set(['chat', 'completions', 'responses', 'messages', 'models', 'embeddings'])
  let baseSegments = [...segments]
  while (baseSegments.length > 0 && resourceSegments.has(baseSegments[baseSegments.length - 1].toLowerCase())) {
    baseSegments.pop()
  }
  // 若去掉资源段后末尾不是 v1（或类似版本段），补一个 v1 变体
  const base = baseSegments.join('/')
  const lastSegment = baseSegments[baseSegments.length - 1]?.toLowerCase() ?? ''
  const versioned = /^v\d/.test(lastSegment)

  const urls: string[] = []
  const build = (suffix: string) => {
    const candidate = new URL(parsed)
    candidate.search = ''
    candidate.pathname = base ? `${base}/${suffix}` : `/${suffix}`
    urls.push(candidate.toString())
  }

  build('models')
  if (!versioned) build('v1/models')

  // 去重保序
  return [...new Set(urls)]
}

interface ModelListFetchResult {
  ok: boolean
  statusCode?: number
  error?: string
  models: FetchedProviderModel[]
}

async function fetchModelList(urlPath: string, protocol: Protocol, apiKey: string | null, timeout: number, signal: AbortSignal): Promise<ModelListFetchResult> {
  const parsed = new URL(urlPath)
  try {
    const response = await coreNetworkClient.requestHttpBuffered(parsed, {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { ...createAuthHeaders(protocol, apiKey, null), Accept: 'application/json' },
      timeout,
      signal,
    }, Buffer.alloc(0))
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { ok: false, statusCode: response.statusCode, models: [] }
    }
    const models = parseModelListResponse(response.body)
    return { ok: models !== null, statusCode: response.statusCode, error: models === null ? '响应不是有效的模型列表 JSON' : undefined, models: models ?? [] }
  } catch (error) {
    return { ok: false, error: signal.aborted ? '客户端已取消请求' : (error as Error).message, models: [] }
  }
}

/** 解析 OpenAI 风格与 Anthropic 风格的 models 响应；无法解析时返回 null */
export function parseModelListResponse(body: string): FetchedProviderModel[] | null {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  if (json === null || typeof json !== 'object' || Array.isArray((json as { data?: unknown }).data) === false) {
    return null
  }

  const models: FetchedProviderModel[] = []
  for (const item of (json as { data: unknown[] }).data) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id) continue
    models.push({
      id,
      ownedBy: typeof record.owned_by === 'string' ? record.owned_by : null,
      displayName: typeof record.display_name === 'string' ? record.display_name : null,
      createdTime: typeof record.created === 'number'
        ? record.created
        : typeof record.created_at === 'string'
          ? Math.floor(new Date(record.created_at).getTime() / 1000)
          : null,
    })
  }
  return models
}
