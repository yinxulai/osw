import type { ApiErrorCode } from './schemas'

/**
 * 需要「按语义识别」的错误码。
 *
 * `ApiErrorCodeSchema` 是错误码全集，供校验与 i18n 使用；但有几处逻辑不是拿它当普通
 * 字符串，而是问「这是不是客户端取消」「这是不是上游故障」。这类判断过去分散在
 * `errors.ts`（规范化入口）、`transports/http.ts`（出网传输）与代理执行层，
 * 各自重新写一遍字面量：任何一处改名漏改，取消就会被当成真实故障——客户端主动中止的
 * 请求会进 failover，还会被标成红色失败。
 *
 * 放在契约层是因为判定的两侧分属不同包：核心层产生取消哨兵文本，传输层与规范化入口
 * 各读一次，谁也不该拥有这个名字。
 */
export const CLIENT_REQUEST_ABORTED: ApiErrorCode = 'CLIENT_REQUEST_ABORTED'

/** 上游故障：本地错误、连接失败等「上游一个字节都没回」的失败统一用它。 */
export const UPSTREAM_ERROR: ApiErrorCode = 'UPSTREAM_ERROR'

/**
 * 客户端取消时销毁上游请求所用的哨兵文本。
 *
 * Node 的 `destroy(error)` 只回传一条 `Error`，跨层传递时拿不到结构化错误码，
 * 因此这里把它做成一个文本哨兵（见 `errors.ts` 的 `normalizeError` 与执行层的
 * `isClientRequestCancelled`）。它与上面的错误码同值、同源，改名时只需改一处。
 */
export const CLIENT_REQUEST_ABORTED_MESSAGE = CLIENT_REQUEST_ABORTED
