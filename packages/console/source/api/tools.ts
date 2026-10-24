import type {
  ModelConnectivityRequest,
  ModelConnectivityResponse,
} from '@common/diagnostics'
import { request } from './client'

/**
 * 诊断结果的形状**不在这一层定义**。
 *
 * 它们住在契约层（`@common/diagnostics`）：服务端按同一份声明产出、界面按同一份声明
 * 消费，任何一边改字段都会在另一边的类型检查里报出来。这里再抄一份形状，等于给
 * 「界面上那一格永远是 —」那种行为级故障留了后门。
 */
export type {
  ModelConnectivityResult,
  ModelTestResult,
  ModelTestRoundResult,
} from '@common/diagnostics'

/*
 * 这里没有 `modelTestApi`。渠道诊断不再由界面发请求：它现在是服务端队列里的一个 kind，
 * 界面只通过 `api/tasks.ts` 入队 / 取消 / 读推送（见 `apps/docs/specs/overview/task-queue.md`）。
 * 留着一条「按目标直连跑一次」的旁路，等于给「状态到底谁说了算」留了第二个答案。
 */

/** 连接测试的入参就是契约里的草稿请求体，不另立一套字段名。 */
export type ModelConnectivityInput = ModelConnectivityRequest

/**
 * 模型对话框里的「连接测试」。
 *
 * 与服务端草稿探测一一对应（见 `@osw/core` 的 `routes/diagnostics/model-connectivity.ts`）：
 * 它测的是**表单里还没保存的那一份**，而且只发真实请求、不写任何库
 * （请求日志、用量、健康冷却都不动），所以它不是「渠道诊断」的轻量版，
 * 而是另一件事——那一边测的是已保存的配置，并且照实记账。
 */
export const modelConnectivityApi = {
  test: (input: ModelConnectivityInput, signal?: AbortSignal) => request<ModelConnectivityResponse>('/model/connectivity-test', input, { signal }),
}

export const developmentApi = {
  seed: () => request<{ inserted: boolean }>('/development/seed'),
}
