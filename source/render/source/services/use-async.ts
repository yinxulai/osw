/**
 * 统一异步状态原语。
 *
 * 设计原则：
 * 1. loading 只表示「请求进行中」，复位逻辑内建在 try/finally，调用方无法遗漏
 * 2. 状态是单一 status 枚举，杜绝 loading=true 且 data 非空等非法组合
 * 3. 空数据是合法的 success 状态，由 UI 渲染空态，而不是卡在 loading
 * 4. 异常不会静默吞掉：默认 toast 提示，调用方也可自行捕获处理
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'

export type AsyncStatus = 'idle' | 'loading' | 'error' | 'success'

export interface AsyncState<T> {
  status: AsyncStatus
  data: T | null
  error: string | null
}

export interface UseAsyncFnOptions {
  /** 出错时是否自动 toast 提示，默认 true */
  toastError?: boolean
  /** loading 超时保险丝（毫秒），超时后强制回到 error 状态，防止按钮永久禁用 */
  timeoutMs?: number
}

export interface UseAsyncFnResult<A extends unknown[], T> {
  status: AsyncStatus
  data: T | null
  error: string | null
  loading: boolean
  /** 执行异步函数；resolve 为函数返回值，reject 为异常（已 toast，通常可忽略） */
  run: (...args: A) => Promise<T | null>
  /** 手动重置回 idle */
  reset: () => void
}

const INITIAL_STATE: AsyncState<unknown> = { status: 'idle', data: null, error: null }

/**
 * 封装「触发式」异步操作（保存、删除、导出等）。
 * loading 状态由 hook 内部管理，调用方只关心 run。
 */
export function useAsyncFn<A extends unknown[], T>(fn: (...args: A) => Promise<T>, options: UseAsyncFnOptions = {}): UseAsyncFnResult<A, T> {
  const { toastError = true, timeoutMs } = options
  const toast = useToast()
  const [state, setState] = useState<AsyncState<T>>(INITIAL_STATE as AsyncState<T>)
  // 用递增序号丢弃过期请求的响应（如快速切换时间范围）
  const seqRef = useRef(0)
  // 用 ref 保存最新 fn，避免 fn 为内联函数时 run 引用不稳定导致 useAsyncData 无限重取
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async (...args: A): Promise<T | null> => {
    const seq = ++seqRef.current
    setState({ status: 'loading', data: null, error: null })

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs) {
      timeoutTimer = setTimeout(() => {
        if (seqRef.current === seq) {
          setState(current => (current.status === 'loading'
            ? { status: 'error', data: null, error: `请求超时（${timeoutMs}ms）` }
            : current))
        }
      }, timeoutMs)
    }

    try {
      const data = await fnRef.current(...args)
      if (seqRef.current !== seq) return null
      setState({ status: 'success', data, error: null })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (seqRef.current === seq) {
        setState({ status: 'error', data: null, error: message })
      }
      if (toastError) toast.error(message)
      return null
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }, [toastError, timeoutMs, toast])

  const reset = useCallback(() => {
    seqRef.current++
    setState(INITIAL_STATE as AsyncState<T>)
  }, [])

  return { status: state.status, data: state.data, error: state.error, loading: state.status === 'loading', run, reset }
}

/**
 * 封装「加载式」异步操作（页面数据获取）。
 * 挂载时自动执行一次；deps 变化时重新执行（如切换筛选条件）。
 * 初始 loading 为 true，与「数据是否为空」无关。
 */
export function useAsyncData<T>(fn: () => Promise<T>, deps: unknown[], options: UseAsyncFnOptions = {}): UseAsyncFnResult<[], T> {
  const { run, ...rest } = useAsyncFn(fn, options)

  // 挂载及 deps 变化时自动执行；run 引用稳定，实际触发由 deps 控制
  useEffect(() => { void run() }, [run, ...deps])

  return { run, ...rest }
}
