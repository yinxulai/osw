import { HttpRouter } from '@server/http-router'
import type { LocalEndpoint } from './local-endpoint'
import { modelCatalogEndpoint } from './model-catalog-endpoint'
import { modelsEndpoint } from './models-endpoint'

/**
 * 全部本地端点的唯一声明处。与 `protocols/registry.ts` 对待协议入口的方式一致：
 * 这里既产出匹配器，也产出可被文档与测试断言的入口清单。
 */
export const localEndpoints: readonly LocalEndpoint[] = [
  modelsEndpoint,
  modelCatalogEndpoint,
]

const localEndpointRouter = new HttpRouter<LocalEndpoint>()
for (const endpoint of localEndpoints) {
  localEndpointRouter.mount({ [endpoint.path]: endpoint }, endpoint.method)
}

/**
 * 按方法与路径匹配本地端点。
 * 未命中返回 `undefined`，由调用方交回代理转发路径（见 `runtime/proxy-runtime.ts`）。
 */
export function matchLocalEndpoint(method: string | undefined, pathname: string): LocalEndpoint | undefined {
  return localEndpointRouter.match(method, pathname)?.handler
}
