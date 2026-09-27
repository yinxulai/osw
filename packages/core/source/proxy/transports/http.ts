import http from 'node:http'
import { CLIENT_REQUEST_ABORTED_MESSAGE } from '@common/error-codes'
import { coreNetworkClient } from '@server/infrastructure/network/core-network'
import type { AttemptView, ExchangeView, Frame, HeaderMap, Transport, UpstreamConnection, UpstreamTarget } from '@server/proxy/contracts'
import { FrameQueue } from './frame-queue'

/** 连接超时错误文案；与既有行为一致。 */
export const CONNECTION_TIMEOUT_MESSAGE = 'Connection timeout'

/** 静默超时错误文案；与既有行为一致。 */
export const IDLE_TIMEOUT_MESSAGE = 'Idle timeout'

/** 上游正文搬到一半就断了连接时的文案。 */
export const UPSTREAM_CLOSED_MESSAGE = 'Upstream closed the connection before finishing the response'

export interface HttpTransportOptions {
  /**
   * 上游两个数据块之间允许的最长静默时间（毫秒），<=0 表示不超时。
   * 由调用方注入设置读取，传输本身不认识设置中心。
   */
  resolveIdleTimeoutMilliseconds(): number | Promise<number>
}

/**
 * HTTP 传输：一次尝试 = 一条请求 = 一条响应。
 *
 * 搬运过程中的几条不变量：
 * - 传输层不解析任何字节，只把上游响应切成 `head` / `data` / `end` / `error` 帧；
 * - `content-length` 一定与实际待发字节数一致（修改器改完正文后可能忘了同步这个头）；
 * - 消费者提前 `break`（例如客户端断开、failover 提前放弃）时立刻销毁上游连接，不留悬挂请求；
 * - 用暂停上游流代替无界缓冲，让慢客户端自然形成背压。
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  return {
    // 一问一答的两种形态共用这一个实现：建连、TLS、超时、abort、出网方式一字不差，
    // 差别只在响应体怎么分帧，而分帧由修改器与响应侧处理，不是一条不同的连接路径。
    transports: ['http', 'http-stream'],
    connect(target: UpstreamTarget, exchange: ExchangeView, attempt: AttemptView): Promise<UpstreamConnection> {
      return connectHttp(target, exchange, attempt, options)
    },
  }
}

function connectHttp(target: UpstreamTarget, exchange: ExchangeView, attempt: AttemptView, options: HttpTransportOptions): Promise<UpstreamConnection> {
  const url = new URL(target.url)
  const requestOptions: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: exchange.method,
    headers: resolveOutboundHeaders(exchange.headers, exchange.body.length),
    timeout: target.timeoutMilliseconds,
  }
  console.debug(`[proxy] transport connect requestId=${exchange.requestId} attempt=${attempt.index} endpointId=${target.endpointId} transport=${exchange.transport} timeout=${target.timeoutMilliseconds}ms bodyBytes=${exchange.body.length}`)

  return new Promise<UpstreamConnection>((resolve, reject) => {
    const queue = new FrameQueue()
    let response: http.IncomingMessage | null = null
    let timer: NodeJS.Timeout | null = null
    let idleTimeoutMilliseconds = 0
    let settled = false

    const detachAbort = () => exchange.signal.removeEventListener('abort', onSignalAbort)
    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const armTimer = () => {
      clearTimer()
      if (idleTimeoutMilliseconds <= 0 || queue.closed || !response) return
      timer = setTimeout(() => {
        timer = null
        response?.destroy(new Error(IDLE_TIMEOUT_MESSAGE))
      }, idleTimeoutMilliseconds)
    }
    const bail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimer()
      detachAbort()
      reject(error)
    }
    const emitTerminal = (frame: Frame) => {
      clearTimer()
      detachAbort()
      queue.push(frame)
      queue.finish()
    }
    const onSignalAbort = () => {
      if (!settled) {
        bail(new Error(CLIENT_REQUEST_ABORTED_MESSAGE))
        return
      }
      // 已建立连接：销毁上游请求，帧序列会以 error 帧收尾。
      request.destroy(new Error(CLIENT_REQUEST_ABORTED_MESSAGE))
    }

    const request = coreNetworkClient.requestHttp(url, requestOptions, exchange.body, {
      onResponse: upstreamResponse => {
        if (settled) {
          // 连接早已被中止/拒绝：不要留下一条没人消费的上游响应。
          upstreamResponse.destroy(new Error(CLIENT_REQUEST_ABORTED_MESSAGE))
          return
        }
        response = upstreamResponse
        queue.bind(upstreamResponse)
        settled = true
        resolve({
          frames: queue,
          abort(reason?: Error) {
            clearTimer()
            queue.cancel()
            upstreamResponse.destroy(reason ?? new Error(CLIENT_REQUEST_ABORTED_MESSAGE))
            request.destroy(reason ?? new Error(CLIENT_REQUEST_ABORTED_MESSAGE))
          },
        })
        queue.push({
          kind: 'head',
          status: upstreamResponse.statusCode ?? 502,
          headers: upstreamResponse.headers,
        })
        // 读不到静默时长（例如设置读取失败）不能放大成未处理的拒绝：那会让一次无关的
        // 读取失败掀掉整个进程。正确的降级是「这次尝试不设静默超时」，并留下一条日志。
        void Promise.resolve(options.resolveIdleTimeoutMilliseconds())
          .then(milliseconds => {
            idleTimeoutMilliseconds = milliseconds
            armTimer()
          })
          .catch((error: unknown) => {
            console.warn(`[proxy] idle timeout unavailable requestId=${exchange.requestId} attempt=${attempt.index} error=${String(error)}`)
          })
        upstreamResponse.on('data', chunk => {
          armTimer()
          queue.push({ kind: 'data', body: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) })
        })
        upstreamResponse.once('end', () => emitTerminal({ kind: 'end' }))
        upstreamResponse.once('error', error => emitTerminal({ kind: 'error', error }))
        // 上游没把正文交完就断开时，`end` 与 `error` 都不会来（只有 `close`）。
        // 不在这里收尾，帧序列就永远等不到终止帧，消费者会一直挂到客户端自己放弃。
        upstreamResponse.once('close', () => {
          if (!upstreamResponse.readableEnded) emitTerminal({ kind: 'error', error: new Error(UPSTREAM_CLOSED_MESSAGE) })
        })
      },
      onError: error => {
        if (!settled) {
          bail(error)
          return
        }
        // 响应已经开始了：把故障交给帧序列，让执行器按「已开始写出」的路径收尾。
        emitTerminal({ kind: 'error', error })
      },
      onTimeout: request => {
        if (!settled) bail(new Error(CONNECTION_TIMEOUT_MESSAGE))
        request.destroy(new Error(CONNECTION_TIMEOUT_MESSAGE))
      },
    })

    exchange.signal.addEventListener('abort', onSignalAbort, { once: true })
    // 信号可能在监听器挂上之前就已经中止过。
    if (exchange.signal.aborted) onSignalAbort()
  })
}

/**
 * 待发头里的 `content-length` 必须等于真实字节数，否则上游会截断或卡住等待。
 * 走 `transfer-encoding: chunked` 时不写这个头。
 */
function resolveOutboundHeaders(headers: HeaderMap, bodyLength: number): http.OutgoingHttpHeaders {
  const resolved: http.OutgoingHttpHeaders = { ...headers }
  const hasTransferEncoding = resolved['transfer-encoding'] !== undefined
  if (!hasTransferEncoding) resolved['content-length'] = String(bodyLength)
  return resolved
}
