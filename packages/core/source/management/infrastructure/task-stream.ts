import type { ServerResponse } from 'node:http'
import { TASKS_STREAM_PROTOCOL_VERSION, type TasksStreamMessage } from '@common/tasks'
import { createFanout } from '@server/realtime/stream-fanout'
import { taskQueue } from '../tasks'

/**
 * 任务队列的推送通道。
 *
 * 传输这一段照抄「进行中的请求」（`live-request-stream.ts`）：同一个 `createFanout`、
 * 同一种帧、同样的背压与心跳。理由与那里逐字相同，不在这里重述——「`POST` + 分块
 * NDJSON」能拿到和 WebSocket 完全一样的东西，而管理 API 的守卫、CORS、路由匹配、
 * 错误边界一条都不用改（见 `core/request-guards.ts`）。
 *
 * 与那两条流唯一的差别是**数据源与寿命**：这里订阅的是通用队列，而队列是进程级台账，
 * 因此这条流**不结束**——它没有「全部推完了」这个时刻，空闲时靠心跳证明连接还活着。
 *
 * 数据走全量快照、不做增量：队列有总量上界（`MAX_QUEUE_TASKS`），重发完整的代价有界，
 * 却天然解决乱序、丢帧、慢客户端与重连对齐。
 */
const fanout = createFanout<TasksStreamMessage>({
  snapshot: () => ({
    protocolVersion: TASKS_STREAM_PROTOCOL_VERSION,
    type: 'snapshot',
    tasks: taskQueue.snapshot(),
  }),
  frameOf,
  heartbeatFrame: frameOf({ protocolVersion: TASKS_STREAM_PROTOCOL_VERSION, type: 'heartbeat' }),
  subscribe: listener => taskQueue.subscribe(listener),
})

/**
 * 把一个响应挂上推送通道，返回退订函数。
 *
 * 调用方负责先把响应头写好并保持连接不关闭；这里只管「什么时候写什么」，不碰状态码、
 * 不碰 `Content-Type`——那些是 HTTP 的事，属于路由那一层。
 */
export function attachTaskStream(res: ServerResponse): () => void {
  return fanout.attach(res)
}

/** 一帧的字节：一条版本化消息。行尾必须有换行，客户端按行分帧。 */
function frameOf(message: TasksStreamMessage): string {
  return `${JSON.stringify(message)}\n`
}
