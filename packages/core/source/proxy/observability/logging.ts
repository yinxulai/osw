/**
 * 日志采集的入口。
 *
 * 只转发使用方真正要调的两个函数：`logging-types` 里的形状是给这几个函数签名用的，
 * 需要类型的调用方（如 `request-entry.ts` 的 `RequestLogger`）直接从那边取，
 * 免得这个 barrel 变成一张「什么都顺手再导出一次」的清单。
 */
export { initializeRequestLogger } from './request-log-collector'
export { createAttemptLogger } from './attempt-log-collector'
