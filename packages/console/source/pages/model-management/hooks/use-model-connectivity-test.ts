import { useCallback, useRef, useState } from 'react'
import { localizeErrorCode } from '@/api/errors'
import { modelConnectivityApi, type ModelConnectivityResult } from '@/api/tools'
import { useTranslation } from '@/i18n/provider'
import type { Protocol } from '@common/schemas'

/** 一行草稿端点在界面上的形状：就这两件事——测哪个协议、打哪个地址。 */
export interface ConnectivityTestTarget {
  protocol: Protocol
  /** 模型级覆盖地址；留空表示用供应商级地址。 */
  endpointUrl: string
}

interface ConnectivityTestState {
  status: 'idle' | 'running' | 'success' | 'error'
  results: ModelConnectivityResult[]
  /** 请求整体失败（没走到上游，例如供应商没了）时的界面文案；逐行的失败在 `results` 里。 */
  errorMessage?: string
}

/**
 * 探测结果在对话框里要展示的全部内容。
 *
 * 界面拿到的就是这一整块：它不需要知道请求怎么发出去的，也不需要自己把结果拼起来，
 * 于是「结果长什么样」这件事只有这里一处定义。
 */
export type ModelConnectivityTestState = ConnectivityTestState

/** 返回给界面的探测状态 + 两个动作；成功后没有缓存、没有失效，点一次就是打一次。 */
export type ModelConnectivityTest = ModelConnectivityTestState & {
  run: (providerId: string, modelName: string, targets: ConnectivityTestTarget[]) => Promise<void>
  reset: () => void
}

/**
 * 探测请求的客户端超时。
 *
 * 与服务端的逐协议超时（供应商自己的 `timeoutMilliseconds`）不是一回事：一行失败不代表
 * 整体失败，但要是上游把连接挂死，服务端的超时可能比用户愿意等的久得多，
 * 没有这个计时器按钮就只会一直转。
 */
const TEST_TIMEOUT_MILLISECONDS = 30_000

/**
 * 「保存前先试一下」的连接测试。
 *
 * 输入的是一份**草稿**，不是数据库里的行：这正是它存在的理由——用户改完地址要先知道
 * 通不通，才愿意保存。因此这里不做任何缓存与失效，每次点都当真打一次。
 */
export function useModelConnectivityTest(): ModelConnectivityTest {
  const t = useTranslation()
  const controllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<ConnectivityTestState>({ status: 'idle', results: [] })

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState({ status: 'idle', results: [] })
  }, [])

  const run = useCallback(async (providerId: string, modelName: string, targets: ConnectivityTestTarget[]) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'running', results: [] })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TEST_TIMEOUT_MILLISECONDS)

    try {
      const response = await modelConnectivityApi.test({ providerId, modelName, endpoints: targets }, controller.signal)
      // 超时也会让上面的 `abort()` 落地，所以必须先判断超时：否则用户看到的会是
      // 「请求被取消」这类由我们自己的计时器造出来的假错误。
      if (timedOut) {
        setState({ status: 'error', results: [], errorMessage: t('models.dialog.testTimeout') })
        return
      }
      // 被下一次点击取代了（或对话框关了），这一次的结果直接丢掉。
      if (controller.signal.aborted) return
      if (!response.success) {
        setState({ status: 'error', results: [], errorMessage: localizeErrorCode(response.errorCode, response.errorMessage, response.errorParams) })
        return
      }
      const failures = response.data.results.filter(result => !result.success)
      // 「整体失败」只有一个判据：**一行都没通**。部分通就在下面逐行说，
      // 好让用户看得见是哪一个协议没过，而不是一句「测试失败」把好的一起否掉。
      setState({
        status: failures.length === response.data.results.length && response.data.results.length > 0 ? 'error' : 'success',
        results: response.data.results.map(result => ({
          ...result,
          // 逐行的错误码在这里就地本地化：结果里混着服务端的英文原文与本地化文案，
          // 让渲染那一层去分辨两种来源容易出错，不如在边界上定死。
          errorMessage: result.success ? undefined : localizeErrorCode(result.errorCode ?? '', result.errorMessage ?? '', result.errorParams),
        })),
      })
    } finally {
      clearTimeout(timer)
    }
  }, [t])

  return { ...state, run, reset }
}
