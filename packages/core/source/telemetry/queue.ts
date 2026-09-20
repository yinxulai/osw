/**
 * 内存队列：攒够一批或到点就发。
 *
 * 落盘的队列看起来更「可靠」，但统计不是业务数据：为它写一份磁盘队列等于在用户机器上多留
 * 一份痕迹，而换来的是「闪退前那一批也补发」——收益与代价正好相反
 * （见 `docs/product/telemetry.md` §12「统计允许丢失」）。
 *
 * 三条纪律：
 * - **队列不设上限，但只保留最近的一批多**：写不出去时丢掉最老的，而不是无限攒着；
 * - **失败就是丢弃**，不重试、不补报；
 * - **从不抛错给调用方**：`report` 是同步的、无返回值的，埋点不接受「上报失败」这个分支。
 */

import type {
  TelemetryBatch,
  TelemetryEnvelope,
  TelemetryEvent,
  TelemetryEventInput,
} from '@common/telemetry'
import {
  TELEMETRY_DEFAULT_BATCH_SIZE,
  TELEMETRY_FLUSH_INTERVAL_MILLISECONDS,
  TELEMETRY_MAX_EVENTS_PER_BATCH,
} from '@common/telemetry'
import type { TelemetrySender } from './sender'

/**
 * 队列上限：批量的若干倍。
 *
 * 它不是「缓冲区」，而是「写不出去时还留多少」：网断了、端点挂了、下游在维护时，队列会一直攒。
 * 超过这个量就丢最老的——统计报文按时间看趋势，留最新的比留最老的更有用，而无限攒下去只会在
 * 恢复时打出一串老掉牙的批次。
 */
const QUEUE_CAPACITY = TELEMETRY_DEFAULT_BATCH_SIZE * 3

export interface TelemetryQueueOptions {
  endpoint: string
  sender: TelemetrySender
  /** 每次组装事件时现算信封字段：语言这类字段在运行中被改是正常情况。 */
  createCommonFields: () => TelemetryEnvelope
  batchSize?: number
  flushIntervalMilliseconds?: number
}

export interface TelemetryQueue {
  /** 入队一条事件。不上报开关、不抛错。 */
  report(input: TelemetryEventInput): void
  /** 把队列里剩下的立刻发出去（关闭统计时的最后一次机会，以及测试里用）。 */
  flush(): void
  /** 只读快照，给预览接口用。 */
  pending(): TelemetryEvent[]
  /** 停掉定时器并丢掉未发出的事件。 */
  stop(): void
}

export function createTelemetryQueue(options: TelemetryQueueOptions): TelemetryQueue {
  const batchSize = clampBatchSize(options.batchSize ?? TELEMETRY_DEFAULT_BATCH_SIZE)
  const flushIntervalMilliseconds = options.flushIntervalMilliseconds ?? TELEMETRY_FLUSH_INTERVAL_MILLISECONDS
  const queue: TelemetryEvent[] = []
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  /** 批次被丢弃时的唯一反馈：一行 debug。不重试、不弹窗、不进运行日志的 error 级。 */
  function drop(error: unknown): void {
    console.debug('[telemetry] batch dropped', error)
  }

  function send(events: TelemetryEvent[]): void {
    const batch: TelemetryBatch = { events }
    try {
      void options.sender(options.endpoint, batch).catch(drop)
    } catch (error) {
      // 发送端也可以**同步**抛错（比如端点不是合法 URL）。那条异常不能穿到埋点调用点，
      // 更不能在定时器里变成未捕获异常：统计没有让程序崩的资格。
      drop(error)
    }
  }

  function flush(): void {
    clearTimer()
    if (stopped) return
    while (queue.length > 0) send(queue.splice(0, batchSize))
  }

  function arm(): void {
    if (timer !== null || stopped) return
    timer = setTimeout(flush, flushIntervalMilliseconds)
    // 不 unref 的定时器会替进程续命，统计没有这个资格（对照实例锁心跳：那边是故意不 unref 的）。
    timer.unref()
  }

  function report(input: TelemetryEventInput): void {
    if (stopped) return
    queue.push({ ...options.createCommonFields(), ...input } as TelemetryEvent)
    if (queue.length > QUEUE_CAPACITY) queue.splice(0, queue.length - QUEUE_CAPACITY)
    if (queue.length >= batchSize) flush()
    else arm()
  }

  return {
    report,
    flush,
    pending: () => [...queue],
    stop: () => {
      stopped = true
      clearTimer()
      if (queue.length > 0) console.debug(`[telemetry] ${queue.length} event(s) dropped on shutdown`)
      queue.length = 0
    },
  }
}

/**
 * 批量大小的硬上限由客户端自己守：契约已经把上限定死（超长批次会被 Worker 拒绝），
 * 而 Worker 对超长批次是拒绝而不是截断——截断会静默改变统计口径。
 */
function clampBatchSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.min(Math.floor(value), TELEMETRY_MAX_EVENTS_PER_BATCH)
}
