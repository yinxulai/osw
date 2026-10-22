import type { ApiResponse, ModelTestMode, Protocol } from '@common/schemas'
import type {
  ModelConnectivityRequest,
  ModelConnectivityResponse,
  ModelTestResult,
  ModelTestRunRequest,
  ModelTestRunResponse,
} from '@common/diagnostics'
import { MODEL_TEST_STREAM_PROTOCOL_VERSION, type ModelTestProgressMessage, type ModelTestStreamMessage } from '@common/model-test-stream'
import { parseStreamLine, readNdjsonStream } from './ndjson'
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

/** 目标筛选：留空表示「全部启用中的渠道与模型」。 */
export type ModelTestFilters = Pick<ModelTestRunRequest, 'providerIds' | 'modelIds'>

/** 诊断参数。轮次与提示词只影响这一次测试，不写入任何配置。 */
export type ModelTestOptions = Partial<Pick<ModelTestRunRequest, 'rounds' | 'prompt' | 'inputLength'>>

/**
 * 一次诊断的运行响应是**一条流**，不是一个立刻成形的响应体。
 *
 * 接口那一头每跑完一轮就写一帧（形状见 `@common/model-test-stream`），这里把它读回来：
 * `onProgress` 每轮回调一次，方法返回时给的是整批的最终结论。
 */
export interface ModelTestRunHandlers {
  signal?: AbortSignal
  /**
   * 每跑完一轮回调一次。
   *
   * `result` 是这个目标**到目前为止**的汇总结论（服务端用 `summarizeRounds` 算的）：界面拿它
   * 立刻刷新那一行，不必等整批结束。界面**不重新汇总任何字段**——同一条结论只能有一个算法，
   * 否则服务端日志与面板上会出现两个数（口径见 `apps/docs/specs/diagnostics.md` §6）。
   */
  onProgress?: (progress: ModelTestProgressMessage) => void
}

export const modelTestApi = {
  run: async (protocol: Protocol, mode: ModelTestMode, filters: ModelTestFilters = {}, options: ModelTestOptions = {}, handlers: ModelTestRunHandlers = {}): Promise<ApiResponse<ModelTestRunResponse>> => {
    // 请求体与旧的一次性接口逐字相同：变的是响应怎么送达，不是「怎么问」。
    const body = { protocol, mode, ...filters, ...options }
    /** 最终结论只在 `summary` 那一帧里。没收到它 = 这条流没跑完。 */
    let results: ModelTestResult[] | null = null
    try {
      await readNdjsonStream(
        '/model-test/run',
        body,
        handlers.signal,
        line => parseStreamLine(line, isModelTestStreamMessage, 'model test'),
        message => {
          if (message.type === 'progress') handlers.onProgress?.(message)
          else results = message.results
        },
      )
    } catch (error) {
      // 取消（`signal` 中止）也走这里：队列拿到的是「已取消」结局，不是这个方法说了算。
      return { success: false, errorCode: 'NETWORK_ERROR', errorMessage: (error as Error).message }
    }
    if (results === null) {
      // 流提前断了（服务进程没了、连接被中间层掐了）：没有结论就是失败，不能当成空结果——
      // 「筛选没命中」与「这次请求压根没跑完」在界面上是两件事。
      return { success: false, errorCode: 'NETWORK_ERROR', errorMessage: 'the diagnostic stream ended without a summary' }
    }
    return { success: true, data: { results } }
  },
}

/**
 * 守住这条流的协议边界：版本 + `type` + 消费方真的会读的那一个字段。
 *
 * 不逐字段校验 payload：业务形状的唯一定义在 `@common/diagnostics`（界面上那一格永远是 `—`
 * 那类故障就是「同一个形状抄了两份」的结果），这里再抄一份 zod 只会多一处会漂移的定义。
 * 与 `api/live-stream.ts` 对两条推送流的判据同一尺度。
 */
function isModelTestStreamMessage(value: unknown): value is ModelTestStreamMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { protocolVersion?: unknown; type?: unknown; result?: unknown; results?: unknown }
  if (message.protocolVersion !== MODEL_TEST_STREAM_PROTOCOL_VERSION) return false
  if (message.type === 'progress') return typeof message.result === 'object' && message.result !== null
  return message.type === 'summary' && Array.isArray(message.results)
}

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
