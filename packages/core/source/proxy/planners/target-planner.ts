import type { Protocol, ProviderModelRoute, ProviderModelRouteEndpoint } from '@common/schemas'
import type { AttemptPlanner, PlanResult, PlannerInput, UpstreamTarget } from '@server/proxy/contracts'
import {
  findConvertibleEndpoint,
  findEndpoint,
  getAvailableModels,
  getAvailableModelsBatch,
  type ModelWithProvider,
} from '@server/proxy/routing/router'
import { isWebSocketEndpoint, resolveUpstreamUrl } from '@server/proxy/routing/upstream-url'

/**
 * 默认尝试规划器。
 *
 * 它是整个代理里**唯一**的「路由决策点」：把「逻辑模型 + 客户端协议」翻译成
 * 一份有序的 `UpstreamTarget` 列表（用户排序优先、健康模型优先），并把「一个候选都没有」
 * 的原因一并说清楚。执行器只管按顺序尝试，入口只管把原因翻成拒绝码——路由策略换了
 * （成本最低、延迟最低、工作流编排），只换这个文件。
 *
 * **客户端跳的取值不在这里。** 上游用哪种形态是上游侧的事实：它由端点自己配置的地址决定
 * （`wss://` 是 WebSocket，其余地址上忠实转发），客户端说要 WebSocket 也改变不了一个
 * `https://` 端点的形态。客户端偏好从不改变哪个上游端点合法（见 `docs/product/proxy-engine.md` §2.3.1）。
 *
 * 三层信息在这里合成一份结果，任何一层都不需要知道另外两层：
 * - `routing/router`：谁能用（启用、健康、手动锁定）与端点匹配；
 * - 本文件：怎么把匹配结果拼成一次连接需要的全部事实（含 URL 与自定义鉴权头）；
 * - 调用方：拿不到候选时该说什么（`reason` / `detail`）。
 *
 * `buildUpstreamTarget` 是这个文件对外开的第二个口：一个模型的字段映射只有一份，
 * 批量规划与「测试连接」这种单点探测都走它。
 */
export const proxyTargetPlanner: AttemptPlanner = {
  id: 'proxy-target',
  plan: planProxyTargets,
  planMany: planProxyTargetsBatch,
}

/** 手动锁定的模型用不了时的说明：手动与自动的区别只在这句话里，因此只有一个来源。 */
const MANUAL_UNAVAILABLE_DETAIL = 'The manually selected ProviderModel is not available for this protocol'

/** 一个候选都没有且不是手动锁定时：既没有绑定模型、又都不可用。 */
const NO_MODEL_DETAIL = 'This logical model has no enabled and healthy provider model'

export async function planProxyTargets(input: PlannerInput): Promise<PlanResult> {
  const { logicalModelId, clientProtocol: protocol, manualModelId } = input
  const availableModels = await getAvailableModels(logicalModelId, { manualModelId })
  return planFromAvailableModels(availableModels, protocol, manualModelId)
}

/** 批量规划入口：数据查询一次做完，每个落点仍按同一套规则独立判定。 */
export async function planProxyTargetsBatch(inputs: readonly PlannerInput[]): Promise<readonly PlanResult[]> {
  const availableByLogicalModel = await getAvailableModelsBatch(inputs.map(input => ({
    logicalModelId: input.logicalModelId,
    manualModelId: input.manualModelId,
  })))
  return inputs.map(input => planFromAvailableModels(
    availableByLogicalModel.get(input.logicalModelId) ?? [],
    input.clientProtocol,
    input.manualModelId,
  ))
}

function planFromAvailableModels(availableModels: readonly ModelWithProvider[], protocol: Protocol, manualModelId: string | null): PlanResult {
  // 手动模式下「候选为空」永远是「手动指定的模型不可用」，哪怕它是被删掉了：
  // 这种情况绝不能退化成「没有可用供应商」，否则用户看到的是一条与他的操作无关的报错。
  if (availableModels.length === 0) {
    return manualModelId === null
      ? { targets: [], reason: 'model-not-configured', detail: NO_MODEL_DETAIL }
      : { targets: [], reason: 'manual-model-unavailable', detail: MANUAL_UNAVAILABLE_DETAIL }
  }

  const targets = availableModels.flatMap(candidate => {
    const target = buildUpstreamTarget(candidate, protocol)
    return target === null ? [] : [target]
  })
  if (targets.length === 0) {
    return manualModelId === null
      ? { targets: [], reason: 'no-available-provider', detail: describeCandidates(availableModels, protocol) }
      : { targets: [], reason: 'manual-model-unavailable', detail: MANUAL_UNAVAILABLE_DETAIL }
  }

  return { targets, reason: 'none' }
}

/**
 * 把一个候选拼成一次连接需要的全部事实；这个候选服务不了该协议时返回 `null`。
 *
 * 执行器与传输层只认这份结果，不再回查模型与供应商。规划器批量规划时用它；
 * 设置页的「测试连接」只有一个特定模型要测、没有候选可排，也用同一个口，
 * 免得 URL 规范化、自定义鉴权头、端点标识这些字段映射在两处各写一遍、各自漂移。
 */
export function buildUpstreamTarget(candidate: ModelWithProvider, protocol: Protocol): UpstreamTarget | null {
  const endpoint = selectEndpoint(candidate.model, protocol)
  if (endpoint === undefined) return null
  const url = readUpstreamUrl(endpoint.endpointUrl)

  return {
    providerId: candidate.provider.id,
    providerName: candidate.provider.name,
    providerModelId: candidate.model.id,
    providerModelName: candidate.model.modelName,
    apiKeyReference: candidate.provider.apiKeyReference,
    customAuthHeader: endpoint.customAuthHeader,
    endpointId: resolveEndpointId(candidate.model, endpoint.protocol),
    protocol: endpoint.protocol,
    url,
    timeoutMilliseconds: candidate.provider.timeoutMilliseconds,
  }
}

/**
 * 挑选这次连接要用的端点。
 *
 * 原生端点永远优先；没有原生端点时，只有 HTTP 端点能接受「协议转换」的候选：
 * 双向长连接跨协议意味着要把两个方向上的帧桥接成请求再桥回来，那不是一个转换适配器
 * 能承担的事。
 *
 * 判据是**端点自己的地址**，不是客户端的偏好：换成客户端传什么都要看这个端点能不能用，
 * 客户端说要 WS 也不会让一个 `https://` 端点变成转换候选。
 *
 * **没有地址的端点不算端点。** 供应商端点行可以只作为「协议载体」存在（地址为空串，
 * 见 `../../database/model-store.ts`），供应商包导入导出时也会短暂出现这种行。它一旦被选中，
 * 交给传输层的就是一个空地址——那既不是「写错的地址」，也没有任何重试或健康冷却能救，
 * 只会让这个候选白白消耗一次尝试。没有可用地址就当这个协议没配。
 */
function selectEndpoint(model: ProviderModelRoute, protocol: Protocol): ProviderModelRouteEndpoint | undefined {
  const native = findEndpoint(model, protocol)
  if (native && isDialableEndpoint(native)) return native
  const convertible = findConvertibleEndpoint(model, protocol)
  if (!convertible || !isDialableEndpoint(convertible)) return undefined
  if (isWebSocketEndpoint(convertible.endpointUrl)) return undefined
  return convertible
}

function isDialableEndpoint(endpoint: ProviderModelRouteEndpoint): boolean {
  return endpoint.endpointUrl.trim().length > 0
}

/**
 * 上游地址：能解析就规范化，不能解析也原样交出去。
 *
 * 规划器不是校验器——一个写错的地址只该让**那一个**候选失败（其他候选照旧可切），
 * 因此这里不抛错。地址按原样发给传输层，由那次连接自己失败并计入健康冷却。
 */
function readUpstreamUrl(endpointUrl: string): string {
  try {
    return resolveUpstreamUrl(endpointUrl)
  } catch {
    return endpointUrl
  }
}

/**
 * 模型端点的稳定标识。
 *
 * 模型端点不是独立实体（一个模型在一个协议下最多一个端点），因此用「模型 + 协议」
 * 定位它：既能指到具体端点，也不会因为调度顺序变化而变。
 */
function resolveEndpointId(model: ProviderModelRoute, endpointProtocol: Protocol): string {
  return `${model.id}:${endpointProtocol}`
}

/**
 * 为什么一个候选都用不上。这段文字同时是日志与用户看到的错误信息（英文原文），
 * 只说事实、不猜原因；界面按 `errorCode` 自己本地化，不把这句英文当模板用。
 */
function describeCandidates(availableModels: readonly ModelWithProvider[], protocol: Protocol): string {
  const discovered = availableModels.map(candidate => `${candidate.provider.name}/${candidate.model.modelName}`).join(', ')
  const suffix = discovered ? `, discovered: ${discovered}` : ''

  // 「没开协议转换」和「开了但端点不是 HTTP 形态」必须分开说：合成一句「未开启协议转换」在后一种
  // 情况下就是假话，会让人去改一个本来就是打开的开关。
  const crossShapeProtocols = [...new Set(availableModels.flatMap(candidate => candidate.model.endpoints
    .filter(endpoint => endpoint.protocol !== protocol
      && endpoint.protocolConversionEnabled
      && isWebSocketEndpoint(endpoint.endpointUrl))
    .map(endpoint => endpoint.protocol)))]
  if (crossShapeProtocols.length > 0) {
    return `Available provider models do not natively configure the ${protocol} protocol, the convertible endpoints are WebSocket and cross-shape conversion is out of scope (convertible protocols: ${crossShapeProtocols.join(', ')})${suffix}`
  }

  // 「绑了协议但没填地址」也得单独说：说成「没配这个协议」会和后面那行 configured protocols 自相矛盾，
  // 而那行恰恰会把这个协议列出来。
  const addressless = availableModels
    .filter(candidate => candidate.model.endpoints.some(endpoint => endpoint.protocol === protocol && !isDialableEndpoint(endpoint)))
    .map(candidate => `${candidate.provider.name}/${candidate.model.modelName}`)
  if (addressless.length > 0) {
    return `Available provider models bind the ${protocol} protocol but have no upstream url configured: ${addressless.join(', ')}`
  }

  const configuredProtocols = [...new Set(availableModels.flatMap(candidate => candidate.model.endpoints.map(endpoint => endpoint.protocol)))]
  return `Available provider models have no ${protocol} protocol configured and protocol conversion is disabled (configured protocols: ${configuredProtocols.join(', ') || 'none'})${suffix}`
}
