import type { ModelTestResult } from '@common/diagnostics'
import type { ModelTestMode, Protocol } from '@common/schemas'
import { modelTestApi } from '@/api/tools'
import type { AppTranslator } from '@/i18n/provider'
import { runTaskQueue } from '@/lib/task-queue'

/**
 * 渠道诊断的执行器：**一个类，不是一套 hook**。
 *
 * 状态、并发、取消、订阅都在这个类里，界面只做两件事：调 `run()` 交给它一批任务，
 * 再用 `subscribe()` 拿变更通知。这样做的理由不是「class 更好看」，而是这三件事
 * 本来就不属于某一个组件：
 *
 * - 并发与收尾是**队列语义**，和 React 的渲染周期无关，写进 hook 就只能靠
 *   `useEffect` + ref 去模拟，时序反而更难说清；
 * - 每个任务都是一次真实的上游请求、真金白银，它需要能在**没有 React 环境**下被测；
 * - 面板关掉再打开、切换页面再回来，队列本身不该跟着重建。
 *
 * 快照的约定照抄 `useSyncExternalStore` 的要求：**没变就返回同一个引用**。
 * 每次 `publish()` 才换新对象，React 因此不会因为「值一直在变」反复重渲染。
 */

export type TestTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

/**
 * 正在跑的那个目标的轮次进度。
 *
 * `round` 是刚跑完的那一轮，`totalRounds` 是这个目标这一批要跑几轮（没配上游地址时是 1 ——
 * 那一轮就是全部）。界面的「第 N/M 轮」读的就是它，不自己拿 `config.rounds` 与「收了几帧」
 * 相减——服务端才知道它真的打算跑几轮。
 */
export interface TestRoundProgress {
  round: number
  totalRounds: number
}

export interface TestTask {
  /** `模型 id:协议`。同一行在重测时必须命中同一格，所以 id 是稳定的。 */
  id: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  converted: boolean
  status: TestTaskStatus
  result?: ModelTestResult
  errorMessage?: string
  /**
   * 只在 `running` 时有值：每跑完一轮由服务端的进度帧刷新一次，收尾时清掉。
   *
   * `result` 会**同时**被刷新成「到目前为止」的汇总结论，所以这一行在跑的过程中就能显示
   * 首字 / 耗时 / Token / 速度——不再只在整批结束后才从 `—` 变成数字。
   */
  roundProgress?: TestRoundProgress
}

/** 一批诊断要用的参数。只影响这一批，不改任何保存的配置。 */
export interface TestRunOptions {
  mode: ModelTestMode
  concurrency: number
  rounds: number
  /** 空串表示「不指定」，由服务端按模式取默认提示词。 */
  prompt: string
  inputLength: number
  /**
   * 兜底文案的来源。
   *
   * 执行层不内置任何语言，所以由调用方在**开跑那一刻**把 `translate` 交进来：
   * 这一批的结局会用这一批开跑时的措辞，语言在跑的过程中被切换也不会让同一张表
   * 里一半中文一半英文。
   */
  translate: AppTranslator
}

/** 界面订阅到的一份状态。只在真的变了时才换引用。 */
export interface ModelTestSnapshot {
  tasks: readonly TestTask[]
  running: boolean
}

const EMPTY: ModelTestSnapshot = { tasks: [], running: false }

export class ModelTestRunner {
  private tasks: TestTask[] = []
  private running = false
  private controller: AbortController | null = null
  private snapshot: ModelTestSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  /**
   * 还有没有人在听。**默认是活的**，只有 {@link detach} 会关掉它。
   *
   * 这个标记不能叫 `disposed` 并且一经置位就永不复原：那种写法在 `React.StrictMode`
   * 下会让执行器在挂载那一刻就死掉，之后点「开始诊断」永远没反应（详见 `detach`）。
   */
  private attached = true

  /** 订阅状态变更；返回退订函数。React 侧直接把它交给 `useSyncExternalStore`。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    /*
     * 有人来订阅 = 这个执行器又活了。
     *
     * StrictMode 的「假卸载」之后 React 会重新订阅，靠这一步把上一次 `detach`
     * 关掉的门重新打开——所以 `detach` 必须是可逆的。
     */
    this.attached = true
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 当前状态。没变更时返回同一个引用，符合外部 store 的快照约定。 */
  readonly getSnapshot = (): ModelTestSnapshot => this.snapshot

  /**
   * 跑一批任务。
   *
   * 已经在跑时直接忽略——诊断会计费，任何时候都只允许一批在飞。这个判断必须是
   * **同步**的：连点两下「开始诊断」时两个事件处理器都在同一次渲染之前执行，
   * 靠状态位去挡是挡不住的。
   */
  readonly run = async (batch: readonly TestTask[], options: TestRunOptions): Promise<void> => {
    if (!this.attached || this.running || batch.length === 0) return

    const controller = new AbortController()
    this.running = true
    this.controller = controller

    // 重测的行就地在原表里重启：其它行的结论原样保留，不整表重建。
    const pending: TestTask[] = batch.map(task => ({
      ...task,
      status: 'queued',
      result: undefined,
      errorMessage: undefined,
      roundProgress: undefined,
    }))
    const byId = new Map(pending.map(task => [task.id, task]))
    this.tasks = this.tasks.length === 0 ? pending : this.tasks.map(task => byId.get(task.id) ?? task)
    this.publish()

    try {
      await runTaskQueue(pending, {
        concurrency: options.concurrency,
        signal: controller.signal,
        run: async (task, signal) => modelTestApi.run(task.protocol, options.mode, {
          providerIds: [task.providerId],
          modelIds: [task.modelId],
        }, {
          rounds: options.rounds,
          // 空提示词不发：不发与服务端会回退到该模式的默认提示词，两边口径一致。
          prompt: options.prompt.trim() || undefined,
          inputLength: options.inputLength,
        }, {
          signal,
          /*
           * 每跑完一轮就把这一行刷新一次。
           *
           * `result` 一并写进去（而不是等收尾）：这一行显示的首字 / 耗时 / Token / 速度都从
           * `result` 读，只更新「第几轮」的话，慢上游下还是要等整批结束才看得到读数——
           * 而「边跑边出」要的正是这些读数。
           */
          onProgress: progress => {
            this.updateTask(task.id, {
              roundProgress: { round: progress.round, totalRounds: progress.totalRounds },
              result: progress.result,
            })
          },
        }),
        onStart: task => {
          this.updateTask(task.id, { status: 'running' })
        },
        onSettled: (task, outcome) => {
          if (outcome.status === 'cancelled') {
            // 取消不是失败：错误也要清掉，否则上一轮的红字会挂在一条「已取消」的行上。
            // `result` 留着——已经跑完的那几轮是真金白银换来的，不该因为取消就消失；
            // 轮次进度则收掉：这一行已经没有「正在跑第几轮」这回事了。
            this.updateTask(task.id, { status: 'cancelled', errorMessage: undefined, roundProgress: undefined })
            return
          }
          if (outcome.status === 'failed') {
            this.updateTask(task.id, {
              status: 'failed',
              errorMessage: outcome.error instanceof Error ? outcome.error.message : options.translate('modelTest.error.requestFailed'),
              roundProgress: undefined,
            })
            return
          }
          const response = outcome.value
          // 服务端一次只测一个目标，但筛选没命中时它可能回一个空集：那一行不能说「成功」。
          const result = response.success ? response.data.results.find(item => item.modelId === task.modelId) : undefined
          this.updateTask(task.id, {
            status: result?.success ? 'success' : 'failed',
            result,
            roundProgress: undefined,
            errorMessage: response.success
              ? result ? result.errorMessage : options.translate('modelTest.error.missingEndpoint')
              : response.errorMessage,
          })
        },
      })
    } finally {
      if (this.controller === controller) this.controller = null
      this.running = false
      this.publish()
    }
  }

  /** 中断在跑的那一批；排队与在飞的任务都会收成 `cancelled`（由队列保证）。 */
  readonly cancel = (): void => {
    this.controller?.abort()
  }

  /** 清空结果表；在跑时不清（那会让「进行中」的行凭空消失）。 */
  readonly clear = (): void => {
    if (this.running) return
    this.setTasks([])
  }

  /**
   * 与 React 侧断开：掐掉在飞的请求（用户已经离开，不该继续计费），并退掉所有订阅
   * （剩下的收尾不会再通知任何人）。
   *
   * **这是可逆的**，而且必须可逆。`React.StrictMode` 会故意把每个 effect
   * 「挂载 → 清理 → 再挂载」跑一遍，用来暴露副作用不幂等的问题。清理里做**不可逆**
   * 的状态变更，等于组件第一次挂载就把自己弄死；而 `new ModelTestRunner()` 在
   * `useMemo` 里只建一次，那一个实例于是永久失效——这正是这个类曾经的事故：
   * 清理时置 `disposed = true` 且永不复原，表现就是**点「开始诊断」毫无反应**。
   * 单测没发现，是因为测试里的 `render()` 没有套 StrictMode（真实应用里开着）。
   *
   * 所以这里只关「门」，不砸「锁」：{@link subscribe} 会把门重新打开。
   */
  detach(): void {
    this.attached = false
    this.controller?.abort()
    this.listeners.clear()
  }

  private setTasks(tasks: TestTask[]): void {
    this.tasks = tasks
    this.publish()
  }

  private updateTask(taskId: string, patch: Partial<TestTask>): void {
    let found = false
    const next = this.tasks.map(task => {
      if (task.id !== taskId) return task
      found = true
      return { ...task, ...patch }
    })
    if (found) this.setTasks(next)
  }

  private publish(): void {
    this.snapshot = this.tasks.length === 0 && !this.running ? EMPTY : { tasks: this.tasks, running: this.running }
    for (const listener of this.listeners) listener()
  }
}
