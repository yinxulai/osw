import { z } from 'zod'
import type { LiveMetrics } from './live-metrics'

/**
 * 实时指标推送协议版本。
 *
 * 版本写在每一条消息里而不是握手一次：NDJSON 没有协商阶段，单条消息可独立判断。
 * 版本不兼容时客户端必须丢弃而不是猜测字段含义。
 */
export const LIVE_METRICS_STREAM_PROTOCOL_VERSION = 1

const LiveMetricsStreamEnvelopeSchema = z.object({
  protocolVersion: z.literal(LIVE_METRICS_STREAM_PROTOCOL_VERSION),
})

/**
 * 指标快照。
 *
 * 与「进行中的请求」那条流同构：不做增量、每条快照都是**全量**的当下真相。
 * 指标本身只有几个标量，全量重发比设计增量便宜得多，也天然免疫乱序与丢帧。
 *
 * `metrics` 的形状由 `@common/live-metrics` 的 `LiveMetrics` 定义；这里只守住线路协议
 * 边界（对象、非空），不逐字段校验——本机同版本服务，字段可信度沿用其他管理 API 的约定。
 */
export const LiveMetricsStreamSnapshotMessageSchema = LiveMetricsStreamEnvelopeSchema.extend({
  type: z.literal('snapshot'),
  metrics: z.custom<LiveMetrics>(),
})
export type LiveMetricsStreamSnapshotMessage = z.infer<typeof LiveMetricsStreamSnapshotMessageSchema>

/** 只证明连接仍然活着，不携带也不改变业务状态。 */
export const LiveMetricsStreamHeartbeatMessageSchema = LiveMetricsStreamEnvelopeSchema.extend({
  type: z.literal('heartbeat'),
})
export type LiveMetricsStreamHeartbeatMessage = z.infer<typeof LiveMetricsStreamHeartbeatMessageSchema>

/** 推送流里一行的完整类型集合；`type` 是唯一的消息判别字段。 */
export const LiveMetricsStreamMessageSchema = z.discriminatedUnion('type', [
  LiveMetricsStreamSnapshotMessageSchema,
  LiveMetricsStreamHeartbeatMessageSchema,
])
export type LiveMetricsStreamMessage = z.infer<typeof LiveMetricsStreamMessageSchema>
