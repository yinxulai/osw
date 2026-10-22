import type { ModelTestResult } from './diagnostics'

/**
 * 渠道诊断的**渐进式交付**协议：`POST /api/model-test/run` 的响应体。
 *
 * ## 为什么这个接口要有自己的流
 *
 * 一次诊断的结论是「目标 × 轮次」的矩阵，而每一轮都是一次真实的上游请求——慢上游下
 * 一整轮能拖十几秒。原先整批结论只在最后成形（一份 JSON），界面在这期间**一个字节都
 * 收不到**：行停在进行中，读数恒为 `—`。用户看到的「卡住了」不是界面没刷新，
 * 而是这份响应在契约上就只承认终态。
 *
 * 所以接口改成一行一帧的 NDJSON：**每一轮跑完写一条 `progress`，整批跑完写一条
 * `summary`，随后连接结束**。分帧方式与「进行中的请求」「实时指标」那两条推送流同一套
 * （`api/ndjson.ts` 那份分帧骨架），差别只有两点：这条流**会结束**，且它的数据源是
 * 这一次请求本身，不是进程级台账——所以它不走 `createFanout`（那是给「一源多订阅者、
 * 每个订阅者看同一份快照」的通道用的）。
 *
 * ## 为什么 `progress` 带的是**汇总结论**而不是这一轮的明细
 *
 * 界面上那一行显示的是「这个目标算不算通过、有多快」，它的定义在服务端
 * （`summarizeRounds`，口径见 `apps/docs/specs/diagnostics.md` §6）。若事件只带单轮明细，
 * 界面就得自己把几轮压成一行——同一条结论于是有了两个算法，服务端日志与面板上会给
 * 出两个数。所以每一帧里带的是「到目前为止的汇总结论」，界面只负责画。
 *
 * 代价是帧里的 `result.rounds` 会随轮次增长而重复（第 N 帧带上前 N 轮）。轮次是用户
 * 自己的选择、连接是本机回环，这点重复换来的是「界面一个汇总结论都不许自己算」这条
 * 口径不被破坏。
 *
 * ## 为什么这里没有 zod schema
 *
 * 两条推送流的契约各带一份 zod（`LiveRequestStreamSnapshotMessageSchema` 等），因为
 * 它们描述的是**新**形状。这条流的负载就是已经存在的 {@link ModelTestResult}——把它
 * 再抄成一份 zod 镜像，等于给「界面上那一格永远是 —」那类行为级故障留第二处定义
 * （`diagnostics.ts` 头部讲的就是这个教训）。消费端只在**协议边界**上做窄校验
 * （版本 + `type` + 用到的判别字段），与 `api/live-stream.ts` 对推送流的做法一致。
 */

/**
 * 流协议版本。
 *
 * 与两条推送流同一约定：版本写在每一条消息里而不是握手一次（NDJSON 没有协商阶段），
 * 客户端遇到不认识的版本必须丢弃，而不是猜字段含义。
 */
export const MODEL_TEST_STREAM_PROTOCOL_VERSION = 1

/**
 * 一轮跑完就发一条。
 *
 * 自带的身份是给「一次请求承载多个目标」那种调用方用的（界面侧拆成一次一个，
 * 见 `apps/docs/specs/diagnostics.md` §2）；界面的执行器按 `modelId` 认领，不靠顺序。
 */
export interface ModelTestProgressMessage {
  protocolVersion: typeof MODEL_TEST_STREAM_PROTOCOL_VERSION
  type: 'progress'
  modelId: string
  providerId: string
  /** 刚跑完的那一轮，1 起。界面的「第 N/M 轮」读的就是它。 */
  round: number
  /** 这个目标这一批总共要跑几轮。没配上游地址时是 1：那一轮就是全部。 */
  totalRounds: number
  /** 到目前为止的汇总结论（`summarizeRounds` 的口径）。界面不重新汇总。 */
  result: ModelTestResult
}

/**
 * 整批跑完发一条，随后连接结束。
 *
 * `results` 与旧的一次性响应逐字相同，因此这次改动只换交付方式、不换结论的形状。
 */
export interface ModelTestSummaryMessage {
  protocolVersion: typeof MODEL_TEST_STREAM_PROTOCOL_VERSION
  type: 'summary'
  /** 每个被测目标一条，顺序与目标规划顺序一致。 */
  results: ModelTestResult[]
}

/** 流里一行的完整类型集合；`type` 是唯一的消息判别字段。 */
export type ModelTestStreamMessage = ModelTestProgressMessage | ModelTestSummaryMessage
