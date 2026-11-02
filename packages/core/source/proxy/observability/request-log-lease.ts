import { cancelPendingRequestLogsBefore } from '@server/database/request-log-store'

/**
 * 一个请求行最多允许停留在 `pending` 多久。
 *
 * 真实的模型请求不可能跑上几个小时；超过这个时长只可能是生命周期出了故障
 * （进程崩溃、收尾写入永久失败、某条代码路径既没返回也没抛错）。租约到期后由进程
 * 自己把它收尾为 `cancelled`，而不是等下一次启动——桌面应用可以连续运行好几天。
 */
export const PENDING_REQUEST_LOG_LEASE_MILLISECONDS = 6 * 60 * 60 * 1000

/**
 * 运行期清扫的周期。
 *
 * 它兜住的是「内存里的定时器丢了」这一类情况（例如请求入口的租约还没建立就异常退出）。
 * 一分钟一次足够及时，扫的又是一条带状态与时间索引的查询，代价可以忽略。
 */
export const PENDING_REQUEST_LOG_SWEEP_INTERVAL_MILLISECONDS = 60_000

/** 日志里最多列出几个被清扫的请求 id：够定位即可，不该把几千个 id 塞进一行。 */
const SAMPLE_REQUEST_ID_COUNT = 5

export interface RequestLogLeaseOptions {
  requestId: string
  startedAt: number
  /** 租约到期时的收尾动作：写终态、中止请求、落定台账由调用方组合。 */
  onExpire: () => void | Promise<void>
  /** 测试与特殊调用方可以覆盖；生产一律用默认租约。 */
  timeoutMilliseconds?: number
}

export interface RequestLogLease {
  /** 取消定时器。正常收尾与任何异常路径都必须调用；重复调用无副作用。 */
  dispose(): void
}

/**
 * 给一次客户端请求挂上内存租约。
 *
 * 定时器 `unref`：它是兜底，不是进程存在的理由——不该让一个 6 小时的定时器
 * 拖住进程退出。回调里的异常只记录，不产生未处理的 rejection。
 */
export function startRequestLogLease(options: RequestLogLeaseOptions): RequestLogLease {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? PENDING_REQUEST_LOG_LEASE_MILLISECONDS
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null
    // 到期只执行一次：把 timer 置空后即使有迟到的回调也不会再跑。
    if (disposed) return
    void Promise.resolve()
      .then(options.onExpire)
      .catch(error => {
        console.error(`[proxy] request log lease handler failed requestId=${options.requestId} error=${(error as Error).message}`)
      })
  }, timeoutMilliseconds)
  // 某些测试环境或宿主不提供 `unref`；没有它也必须照常工作。
  timer.unref?.()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

/**
 * 清扫一次过期的 `pending` 请求行，返回被改写的 id。
 *
 * `nowTime` 可显式传入以便测试；判定的是请求行的 `createdTime`，不是进程启动时刻。
 * 只碰 `pending`：任何终态行都不会被这条语句重写。
 */
export async function sweepExpiredPendingRequestLogs(nowTime = Date.now()): Promise<string[]> {
  const cutoffTime = nowTime - PENDING_REQUEST_LOG_LEASE_MILLISECONDS
  const requestIds = await cancelPendingRequestLogsBefore(cutoffTime)
  if (requestIds.length > 0) {
    console.warn(
      `[proxy] cancelled stale pending request logs count=${requestIds.length} reason=lease-expired sampleRequestIds=${requestIds.slice(0, SAMPLE_REQUEST_ID_COUNT).join(',')}`,
    )
  }
  return requestIds
}

/**
 * 启动运行期清扫。返回停止函数。
 *
 * 与 `setInterval` 直接放在模块顶层不同，这里由代理运行时在监听成功后显式启动、
 * 停止/重启前显式关闭：代理没在跑的时候不该还在扫库。
 */
export function startPendingRequestLogSweeper(): () => void {
  const timer = setInterval(() => {
    void sweepExpiredPendingRequestLogs().catch(error => {
      console.error(`[proxy] pending request log sweep failed: ${(error as Error).message}`)
    })
  }, PENDING_REQUEST_LOG_SWEEP_INTERVAL_MILLISECONDS)
  timer.unref?.()

  return () => {
    clearInterval(timer)
  }
}
