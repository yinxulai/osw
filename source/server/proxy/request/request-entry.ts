import type { IncomingMessage, ServerResponse } from 'node:http'
import { listLogicalModels } from '@server/database/logical-model-store'
import { generateId } from '@common/utils'
import { executeProxyRequest } from '../execution/attempt-executor'
import type { ProxyObservationHooks } from '../observability/hooks'
import { NodeProxyResponse } from '../response/proxy-response'
import { createRequestContext } from './request-context'
import { validateLogicalModel } from './request'
import { resolveProxyTargets } from '../routing/routing'
import { detectProtocolFromPath } from '../routing/router'
import { getManualModel } from '../routing/manual-routing'
import { collectRequestAttributes } from '@server/proxy/observability/request-attribute-collector'

export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse, logicalModelId: string, hooks: ProxyObservationHooks = {}): Promise<void> {
  const requestId = generateId('req_')
  const protocol = detectProtocolFromPath(req.url!)
  if (!protocol) {
    console.warn(`[proxy] unknown API path method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} logicalModelId=${logicalModelId} requestId=${requestId}`)
    writeJsonError(res, 404, 'UNKNOWN_API_PATH', '无法识别的 API 路径')
    return
  }

  const requestBody = await readRequestBody(req)
  if (req.aborted) {
    console.debug(`[proxy] client request aborted requestId=${requestId} phase=read-body`)
    return
  }
  console.debug(`[proxy] request accepted requestId=${requestId} method=${req.method ?? 'POST'} path=${req.url ?? '/'} protocol=${protocol} bodyBytes=${requestBody.length}`)
  const modelValidationError = validateLogicalModel(requestBody)
  if (modelValidationError) {
    console.warn(`[proxy] invalid model request requestId=${requestId} protocol=${protocol} reason=${modelValidationError}`)
    writeJsonError(res, 400, 'INVALID_MODEL', modelValidationError)
    return
  }

  const requestedModel = (JSON.parse(requestBody.toString('utf8')) as { model: string }).model.trim()
  const logicalModels = await listLogicalModels()
  const requestedLogicalModel = logicalModels.find(model => model.enabled && (model.id === requestedModel || model.name === requestedModel))
  const resolvedLogicalModel = requestedLogicalModel ?? logicalModels.find(model => model.enabled && model.name === 'default')
  if (!resolvedLogicalModel) {
    console.error(`[proxy] no enabled logical model requestId=${requestId} requestedModel=${requestedModel}`)
    writeJsonError(res, 503, 'NO_MODEL_CONFIGURED', '还没有配置已启用的 default 逻辑模型')
    return
  }
  logicalModelId = resolvedLogicalModel.id
  console.debug(`[proxy] logical model resolved requestId=${requestId} requestedModel=${requestedModel} logicalModelId=${logicalModelId} fallback=${requestedLogicalModel === undefined}`)

  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  const context = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: req.method ?? 'POST',
    path: req.url ?? '/',
    headers: req.headers,
    attributes: collectRequestAttributes(req.headers),
    requestBody,
    signal: controller.signal,
  })
  await hooks.onRequestStarted?.(context)

  const manualModelId = getManualModel(logicalModelId)
  const { availableModels, targets, manualModelUnavailable } = await resolveProxyTargets(logicalModelId, protocol)
  console.debug(`[proxy] routing resolved requestId=${requestId} logicalModelId=${logicalModelId} protocol=${protocol} manualModelId=${manualModelId ?? 'none'} availableModels=${availableModels.length} targets=${targets.length} targetOrder=${targets.map(target => target.model.id).join(',') || 'none'} manualModelUnavailable=${manualModelUnavailable}`)
  if (manualModelUnavailable) {
    console.warn(`[proxy] manual provider model unavailable requestId=${requestId} logicalModelId=${logicalModelId} protocol=${protocol}`)
    writeJsonError(res, 409, 'MANUAL_MODEL_UNAVAILABLE', '手动指定的 ProviderModel 当前不可用于该协议')
    return
  }
  if (targets.length === 0) {
    const configuredProtocols = [...new Set(availableModels.flatMap(candidate => candidate.model.endpoints.map(endpoint => endpoint.protocol)))]
    const reason = availableModels.length === 0
      ? '该逻辑模型队列没有已启用且健康的供应商模型'
      : `可用供应商模型未配置 ${protocol} 协议且未开启协议转换（当前配置协议: ${configuredProtocols.join(', ') || '无'}）`
    const availableTargets = availableModels.length > 0
      ? `，已发现: ${availableModels.map(target => `${target.provider.name}/${target.model.modelName}`).join(', ')}`
      : ''
    console.warn(`[proxy] 没有可用的上游供应商: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${resolvedLogicalModel.name} [${logicalModelId}], requestId=${requestId}, reason=${reason}${availableTargets})`)
    writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', `没有可用的上游 Provider：${reason}`)
    return
  }

  console.debug(`[proxy] execution started requestId=${requestId} logicalModelId=${logicalModelId} targets=${targets.length}`)
  await executeProxyRequest({ context, targets, response: new NodeProxyResponse(res), hooks })
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    req.on('aborted', () => fail(new Error('CLIENT_REQUEST_ABORTED')))
    req.on('error', fail)
  })
}

function writeJsonError(res: ServerResponse, statusCode: number, errorCode: string, errorMessage: string): string {
  const responseBody = JSON.stringify({ success: false, errorCode, errorMessage })
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(responseBody)
  return responseBody
}
