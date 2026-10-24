import type { Protocol, ProviderModelRoute } from '@common/schemas'
import { listProviderModels } from '../../database/model-store'
import { listProviderEndpoints, listProviders } from '../../database/provider-store'
import { buildUpstreamTarget } from '../../proxy/planners/target-planner'
import { findConvertibleEndpoint, findEndpoint } from '../../proxy/routing/router'
import type { DiagnosticTarget } from './run-round'

/**
 * 把**已保存的配置**解析成「这次能测哪些目标」。
 *
 * 这一步是渠道诊断里唯一需要读库的地方，所以它单独成一层：路由只管 HTTP，探测只管
 * 发请求，中间的「用户当下保存的那一份配置意味着哪些可测目标」是这里的全部职责。
 *
 * 解析结果刻意复用规划器（`buildUpstreamTarget`）而不是自己拼 URL：诊断要测的是
 * 真实链路，地址怎么从模型级 / 供应商级 / 协议载体三层里选出来，只能有一个答案。
 * 自己再写一份等于给「诊断通过但真实请求打不通」留了条后门。
 */

/** 一个可测目标：从配置里解析出来的一次「模型 × 协议」。 */
export interface DiagnosticTargetPlan {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  /** 这个协议是原生支持的还是由协议转换产出的（决定请求体里要不要带输出上限）。 */
  converted: boolean
  /**
   * 要打到的上游目标。`null` 表示**两层都没配地址**——保存时的校验会拦住它，
   * 所以只可能是从旧版本继承下来的数据（见 `packages/core/source/errors.ts` 的
   * `endpointUrlMissingError`）。
   */
  target: DiagnosticTarget | null
}

export interface DiagnosticPlanFilter {
  protocol: Protocol
  providerIds?: string[]
  modelIds?: string[]
}

/**
 * 按筛选条件列出可测目标。
 *
 * 「可测」的判定与界面侧一致：模型已启用、这个协议有原生端点或有可转换的端点。
 * 一个模型在同一协议上可能既有原生端点又有转换路径，此时**原生优先**——那才是
 * 用户配的那条链路，转换只是可用的替代。
 */
export async function planDiagnosticTargets(filter: DiagnosticPlanFilter): Promise<DiagnosticTargetPlan[]> {
  const models = await materializeModels()
  const providers = await listProviders()
  const providerMap = new Map(providers.map(provider => [provider.id, provider]))
  const providerEndpoints = new Map(
    await Promise.all(providers.map(async provider => [
      provider.id,
      new Map((await listProviderEndpoints(provider.id))
        .filter(endpoint => endpoint.enabled)
        .map(endpoint => [endpoint.protocol, endpoint.url])),
    ] as const)),
  )

  const providerFilter = filter.providerIds ? new Set(filter.providerIds) : null
  const modelFilter = filter.modelIds ? new Set(filter.modelIds) : null

  const plans: DiagnosticTargetPlan[] = []
  for (const model of models) {
    if (!model.enabled) continue
    if (providerFilter && !providerFilter.has(model.providerId)) continue
    if (modelFilter && !modelFilter.has(model.id)) continue

    const provider = providerMap.get(model.providerId)
    if (!provider) continue

    const directEndpoint = findEndpoint(model, filter.protocol)
    const endpoint = directEndpoint || findConvertibleEndpoint(model, filter.protocol)
    if (!endpoint) continue

    /*
     * 诊断要测的是「用户当下保存的那一份」：端点 URL 为空时借用供应商级配置，
     * 与真实请求的区别只在这里，因此补齐后交给规划器，不自己拼字段。
     */
    const hydrated = {
      model: {
        ...model,
        endpoints: model.endpoints.map(candidate => ({
          ...candidate,
          endpointUrl: candidate.endpointUrl.trim() || providerEndpoints.get(provider.id)?.get(candidate.protocol) || '',
        })),
      },
      provider,
    }

    plans.push({
      modelId: model.id,
      modelName: model.modelName,
      providerId: provider.id,
      providerName: provider.name,
      protocol: filter.protocol,
      converted: !directEndpoint,
      target: buildUpstreamTarget(hydrated, filter.protocol),
    })
  }
  return plans
}

/**
 * 库里的模型行 → 规划器认识的形状。
 *
 * 这层映射长在这里而不是数据库层：`endpoints` 在库里是「地址 + 若干转换开关」，
 * 规划器要的是「每个协议一条端点 + 这条端点能不能转出别的协议」，两者的对应关系
 * 属于「怎么用这份配置」，不属于「怎么存它」。
 */
async function materializeModels(): Promise<ProviderModelRoute[]> {
  const models = await listProviderModels()
  return models.map(model => ({
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      endpointUrl: endpoint.url ?? '',
      customAuthHeader: null,
      protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }))
}
