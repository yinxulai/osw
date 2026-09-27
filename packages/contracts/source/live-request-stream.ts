import { z } from 'zod'
import { LiveRequestSchema } from './schemas'

/**
 * 实时推送协议版本。
 *
 * 版本写在每一条消息里而不是握手一次：NDJSON 没有协商阶段，单条消息可独立判断。
 * 版本不兼容时客户端必须丢弃而不是猜测字段含义；以后升级时也由此保留明确的迁移边界。
 */
export const LIVE_REQUEST_STREAM_PROTOCOL_VERSION = 1

const LiveRequestStreamEnvelopeSchema = z.object({
  protocolVersion: z.literal(LIVE_REQUEST_STREAM_PROTOCOL_VERSION),
})

/**
 * 用一份完整状态替换客户端当前状态。连接建立后的第一条消息必定是这个类型。
 *
 * 这里刻意不做 `request.created` / `request.updated` / `request.removed` 之类的增量：
 * 全量快照的代价只是有限内存台账上的重复传输，却天然解决乱序、丢帧、慢客户端与重连对齐。
 * 一旦引入增量，就必须同时设计每订阅者的序号、缺口检测、重放窗口与快照回退；在那些机制
 * 真正出现之前，半套增量比重复几个字节难维护得多。
 */
export const LiveRequestStreamSnapshotMessageSchema = LiveRequestStreamEnvelopeSchema.extend({
  type: z.literal('snapshot'),
  requests: z.array(LiveRequestSchema),
})
export type LiveRequestStreamSnapshotMessage = z.infer<typeof LiveRequestStreamSnapshotMessageSchema>

/**
 * 只证明连接仍然活着，不携带也不改变业务状态。
 *
 * 心跳与快照使用同一个版本化信封，客户端因此不需要靠「字段缺失」猜消息类型，
 * 也不会把一次心跳误当成空快照。
 */
export const LiveRequestStreamHeartbeatMessageSchema = LiveRequestStreamEnvelopeSchema.extend({
  type: z.literal('heartbeat'),
})
export type LiveRequestStreamHeartbeatMessage = z.infer<typeof LiveRequestStreamHeartbeatMessageSchema>

/** 推送流里一行的完整类型集合；`type` 是唯一的消息判别字段。 */
export const LiveRequestStreamMessageSchema = z.discriminatedUnion('type', [
  LiveRequestStreamSnapshotMessageSchema,
  LiveRequestStreamHeartbeatMessageSchema,
])
export type LiveRequestStreamMessage = z.infer<typeof LiveRequestStreamMessageSchema>
