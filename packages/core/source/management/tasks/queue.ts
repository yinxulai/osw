import { generateId } from '@common/utils'
import type { TaskRecord, TaskStatus } from '@common/tasks'

/**
 * 进程级通用任务队列的**引擎**。
 *
 * ## 它只懂生命周期
 *
 * 一个任务从 `queued` 起步，最多走到 `running`，然后落在 `success` / `failed` /
 * `cancelled` 之一。除此之外引擎什么都不知道：一个 kind 的业务语义（「这一轮是什么」
 * 「算不算通过」「进度长什么样」）通过 `progress` / `result` 两个**不透明**字段原样携带，
 * 引擎不读、不改、不解释它。
 *
 * 所以这里没有也不可能出现「诊断」「模型」「渠道」这些词。渠道诊断只是第一个 kind
 *（`./kinds/model-test.ts`），不是这个模块的定义。
 *
 * ## 为什么不是「`Promise.all` 分批」
 *
 * 队列里的任务都是真的打上游、真的计费，而它们的耗时差异很大（连着挂的渠道 300ms 就回，
 * 慢的上游能拖十几秒）。按固定分片跑时，整批的节奏由最慢的那一片决定——上一片还剩一个
 * 在等，下一片已经开始跑，并发数在一段时间里是「片大小」，不是配置的那个数。
 * 这里按「谁先空出来谁取下一个」发放任务（{@link TaskQueue.pump}），同时在飞的数量
 * 才真的等于 `concurrency`。
 *
 * ## 取消粒度
 *
 * 按 `taskId` 取消。**未开跑的直接出队**：它一个上游请求都还没发出去，也就没有费用；
 * 在跑的通过 `AbortSignal` 在**步边界**收——kind 在每一步开始前检查 `signal.aborted`，
 * 引擎不强行把它掰断（掰断只会留下一个半途的结论）。`cancelled` 是独立结局，不是失败。
 *
 * ## 不落盘
 *
 * 纯内存。重启即空——「此刻有什么在跑」没有恢复语义（见 `@common/tasks` 的文件头）。
 */

/**
 * 一个 kind 的注册信息。
 *
 * `P` 载荷、`R` 结果、`G` 进度各由 kind 自己定，引擎只负责把它们搬来搬去。
 */
export interface TaskKind<P, R, G> {
  kind: string
  /** 同 kind 同时在飞的上限，默认 **1（串行）**。理由见 `apps/docs/specs/overview/task-queue.md`。 */
  concurrency?: number
  /**
   * 把线上来的原始载荷解析成 `P`。解析不过就抛——那一项会被算作 `skipped`。
   *
   * 这一层是必须的：载荷来自 HTTP，运行时是一团 `unknown`，而 `keyOf` / `run` 的签名
   * 要的是已经成形的 `P`。没有它就只能靠类型断言把界面的错误输入直接喂给 kind。
   */
  parse(input: unknown): P
  /** 去重键。同 kind 内 `key` 相同的任务在排队 / 运行中时不会重复入队。 */
  keyOf(payload: P): string
  run(payload: P, context: TaskRunContext<G>): Promise<R>
}

/** 交给 kind 的运行上下文。它从这里拿到 id、取消信号与进度写口。 */
export interface TaskRunContext<G> {
  /** 本次任务的 id，与快照里的 `TaskRecord.id` 同一个。 */
  taskId: string
  /** 取消信号：kind 要在**步边界**检查它，并在中断后尽快返回。 */
  signal: AbortSignal
  /** 汇报一次进行中的观测。引擎只做携带与推送，不看内容。 */
  report(progress: G): void
}

/**
 * 队列总长上界。
 *
 * 它是**内存上界**而不是调度策略：终态项也要靠 `clear` 才回收，所以上限管的是
 * 「这个进程最多替多少条任务记账」。到顶之后新的入队被拒绝（返回 `skipped`），
 * 而不是把旧任务挤掉——旧任务有结论，挤掉它等于把用户刚看到的东西抹了。
 */
export const MAX_QUEUE_TASKS = 500

interface EnqueueResult {
  accepted: number
  skipped: number
}

/** 收尾时要写进记录的那几个字段。 */
interface TaskSettlement {
  result?: unknown
  errorMessage?: string
}

/** 失败原因取错误原文；kind 抛出非 `Error` 时也不该把这一格留空。 */
function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把 kind 声明的并发收成一个真的能用的值。
 *
 * `?? 1` 是不够的：它只接 `null` / `undefined`，而 `NaN` 与 `Infinity` 不是「没声明」，
 * 是声明错了。`NaN` 会让 `inFlight < limit` 恒为假——整条 kind 一个任务都发不出去、
 * 永久停摆（没有任何报错，只是再也不动）；`Infinity` 则是不设上限地全放，
 * 「同一时刻在飞的数量等于 concurrency」这条承诺直接失效。
 *
 * 两者都按 **1** 处理：与文档同一条口径（`apps/docs/specs/operations/diagnostics.md` §5.1
 * 「并发不合法（非正数、非有限值）时按 1 处理」），也与搬走之前那套客户端队列同一条守卫。
 */
function usableConcurrency(declared: number | undefined): number {
  const value = declared ?? 1
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

interface Entry {
  record: TaskRecord
  kind: TaskKind<unknown, unknown, unknown>
  payload: unknown
  controller: AbortController
}

/**
 * 队列。
 *
 * 并发安全不靠锁：Node 是单线程的，每个写方法都在一次同步执行里完成，不存在交错。
 * 一个进程一套队列即可（见 `./index.ts` 的单例）。
 */
export class TaskQueue {
  private readonly kinds = new Map<string, TaskKind<unknown, unknown, unknown>>()
  /** 全部任务，插入顺序即入队顺序（快照顺序由此而来）。 */
  private readonly entries = new Map<string, Entry>()
  /** 每个 kind 当前在飞的数量。 */
  private readonly inFlight = new Map<string, number>()
  /** 写入订阅者。推送通道靠它把「台账变了」变成「推一帧」。 */
  private readonly listeners = new Set<() => void>()

  /** 注册一个 kind。同 `kind` 重复注册时以后者为准。 */
  register<P, R, G>(kind: TaskKind<P, R, G>): void {
    this.kinds.set(kind.kind, kind as TaskKind<unknown, unknown, unknown>)
  }

  /**
   * 订阅队列的每一次写入。返回退订函数。
   *
   * 回调是**同步**的，可能在任意一次写入中触发，因此订阅者只该做一件事：把「脏了」
   * 记下来，真正的快照与推送留给自己的定时器（与 `live-request-store` 同一条约定）。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 当前全部任务的快照，按入队顺序。 */
  snapshot(): TaskRecord[] {
    return [...this.entries.values()].map(entry => ({ ...entry.record }))
  }

  /**
   * 入队一批载荷。
   *
   * 逐项判定，任何一项被拒都不影响其余项：
   *
   * - kind 没注册 → 拒；
   * - 载荷解析不过 → 拒；
   * - 同 kind 同 `keyOf` 已经在排队 / 运行中 → 拒（连点两下不该变成两倍计费）；
   * - 队列已满 → 拒。
   *
   * 拒掉的数量记在返回值的 `skipped` 里。这是**正常的调度结果**，不是请求失败：
   * 一次「全选 → 开始」里本来就可能有一半已经在跑。
   */
  enqueue(kind: string, items: readonly unknown[]): EnqueueResult {
    const definition = this.kinds.get(kind)
    let accepted = 0
    let skipped = 0

    for (const item of items) {
      const entry = definition ? this.accept(definition, item) : null
      if (entry) accepted += 1
      else skipped += 1
    }

    if (accepted > 0) {
      // 入队之后再统一发放：一批里先入队的先跑，与「一次一项」的观感一致。
      this.pump(kind)
      this.notify()
    }
    return { accepted, skipped }
  }

  /**
   * 取消一批任务。返回**本次调用新发出的取消信号数**（口径与 `TaskCancelResponse` 同一份）。
   *
   * 未开跑的：直接标成 `cancelled` 并让它退出调度（它从未发出任何上游请求），算一个。
   * 在跑的：给它发信号，收尾由那次运行自己完成（引擎在它 settle 时归到 `cancelled`），
   * 也**算一个**——尽管此刻它还没落到 `cancelled` 上。
   * 已经结束的、以及已经在取消中的（`signal.aborted` 已为真）：什么都不做，不计数。
   *
   * 所以这个数是「这一次命令碰到了几条任务」，不是「快照里有几条 `cancelled`」。
   */
  cancel(taskIds: readonly string[]): number {
    let cancelled = 0
    for (const taskId of taskIds) {
      const entry = this.entries.get(taskId)
      if (!entry) continue
      if (entry.record.status === 'queued') {
        this.settle(entry, 'cancelled')
        cancelled += 1
        continue
      }
      if (entry.record.status === 'running') {
        // 已经在取消中的不再数一次：`abort()` 不会同步改状态，重复点（或同时给了
        // `taskIds` 与 `kind`）会让同一个任务被计两遍，`cancelled` 就会大于任务总数。
        if (entry.controller.signal.aborted) continue
        entry.controller.abort()
        cancelled += 1
      }
    }
    if (cancelled > 0) this.notify()
    return cancelled
  }

  /** 取消某个 kind 的全部未结束任务。 */
  cancelKind(kind: string): number {
    const ids = [...this.entries.values()]
      .filter(entry => entry.record.kind === kind)
      .filter(entry => entry.record.status === 'queued' || (entry.record.status === 'running' && !entry.controller.signal.aborted))
      .map(entry => entry.record.id)
    return this.cancel(ids)
  }

  /**
   * 清掉终态项，返回真的删掉了几条。
   *
   * **逐条跳过活任务，而不是「有活的就整条空操作」。** 一个活任务都不删（`queued` /
   * `running` 全留），所以「那条在跑的行凭空消失」这件事依然不会发生——旧实现用整条守卫
   * 防的正是它，而这条守卫只剩下副作用。变的只是「一批还在跑时，**已完成**的行也可以被
   * 清掉」：那些行用户已经看过结论了，这正是「清空结果」的语义。
   *
   * ## 整条空操作曾经是一条死锁
   *
   * `MAX_QUEUE_TASKS` 是**内存上界**（见上），终态项也占额度，而终态项**只有这里**一条
   * 回收路径（`entries.delete` 全仓只此一处）。两者一撞就是：只要队列里有任何一条任务还在
   * 跑，入队就已被永久拒绝（满额）而 `clear` 又是空操作——「等着跑完再清」等不到，因为
   * 腾不出额度就发不出新任务。改成逐条跳过后，这条路变成**一键可恢复**。
   */
  clear(): number {
    let cleared = 0
    for (const [id, entry] of [...this.entries]) {
      const status = entry.record.status
      if (status === 'queued' || status === 'running') continue
      this.entries.delete(id)
      cleared += 1
    }
    if (cleared > 0) this.notify()
    return cleared
  }

  /** 队列里当前有没有任务在跑。 */
  isRunning(): boolean {
    return [...this.entries.values()].some(entry => entry.record.status === 'running')
  }

  /** 造一条记录并放上调度台。返回 `null` 表示这一项被拒。 */
  private accept(definition: TaskKind<unknown, unknown, unknown>, item: unknown): Entry | null {
    if (this.entries.size >= MAX_QUEUE_TASKS) return null

    let payload: unknown
    try {
      payload = definition.parse(item)
    } catch {
      // 载荷不属于这个 kind（或形状不对）：拒掉这一项，而不是把整个批次带下水。
      return null
    }

    let key: string
    try {
      key = definition.keyOf(payload)
    } catch {
      // `keyOf` 是 kind 自己的代码，抛错同样只该让这一项被跳过：让异常穿出去会把
      // 「一批里的一项算不出键」变成「整个 HTTP 请求失败」。
      return null
    }
    if (this.hasLiveKey(definition.kind, key)) return null

    const entry: Entry = {
      record: {
        id: generateId('task_'),
        kind: definition.kind,
        key,
        status: 'queued',
        enqueuedAt: Date.now(),
      },
      kind: definition,
      payload,
      controller: new AbortController(),
    }
    this.entries.set(entry.record.id, entry)
    return entry
  }

  /** 同 kind 同键的任务是否已经在排队或运行中。 */
  private hasLiveKey(kind: string, key: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.record.kind !== kind || entry.record.key !== key) continue
      if (entry.record.status === 'queued' || entry.record.status === 'running') return true
    }
    return false
  }

  /**
   * 发放任务：只要某个 kind 还有空位，就取它队首的那个跑起来。
   *
   * 「谁先空出来谁取下一个」的全部实现就是这里——每有一个任务收尾，就调用一次，
   * 于是空出来的那个槽立刻被队首填上，而不是等整批跑完再开下一批。
   */
  private pump(kind: string): void {
    const definition = this.kinds.get(kind)
    if (!definition) return
    const limit = usableConcurrency(definition.concurrency)
    while ((this.inFlight.get(kind) ?? 0) < limit) {
      const next = [...this.entries.values()].find(entry => entry.record.kind === kind && entry.record.status === 'queued')
      if (!next) return
      this.start(next)
    }
  }

  private start(entry: Entry): void {
    const kind = entry.record.kind
    entry.record.status = 'running'
    this.inFlight.set(kind, (this.inFlight.get(kind) ?? 0) + 1)

    const context: TaskRunContext<unknown> = {
      taskId: entry.record.id,
      signal: entry.controller.signal,
      // 进度只写进状态还是 `running` 的记录：未开跑的、已经收尾的都不接受。
      //
      // 这条守卫**挡不住**「已经收到取消信号、但还没在步边界收尾」的那一条——它的状态仍是
      // `running`，进度照样写得进去。那是有意留着的：进度条与状态格读的是同一个状态，
      // 状态还没变、读数就该继续走；真正会出现「取消了还在动」错觉的情形是**状态变了之后**
      // 还在涨，而那正是这里挡住的。
      report: progress => {
        if (entry.record.status !== 'running') return
        entry.record.progress = progress
        this.notify()
      },
    }

    // 同步抛错必须在这里接住：`kind.run` 在返回 promise 之前抛出的异常会穿过
    // `start → pump → enqueue` 回到路由，而这条任务已经停在 `running` 上——槽位再也不会
    // 被放出来，队列就此卡死。同步抛错与异步拒绝在这里合并成同一个结局。
    let running: Promise<unknown>
    try {
      running = entry.kind.run(entry.payload, context)
    } catch (error) {
      this.settle(entry, 'failed', { errorMessage: errorMessageOf(error) })
      return
    }

    void running.then(
      result => {
        // 被取消的那次不发结论：它没有答案，记成成功/失败都不诚实。
        if (entry.controller.signal.aborted) this.settle(entry, 'cancelled')
        else this.settle(entry, 'success', { result })
      },
      error => {
        if (entry.controller.signal.aborted) this.settle(entry, 'cancelled')
        else this.settle(entry, 'failed', { errorMessage: errorMessageOf(error) })
      },
    )
  }

  /** 收尾：写结局、放出槽位、继续发放同一个 kind 的下一项。 */
  private settle(entry: Entry, status: TaskStatus, patch: TaskSettlement = {}): void {
    if (entry.record.status === 'success' || entry.record.status === 'failed' || entry.record.status === 'cancelled') return
    const wasRunning = entry.record.status === 'running'
    entry.record.status = status
    entry.record.finishedAt = Date.now()
    if ('result' in patch) entry.record.result = patch.result
    if (patch.errorMessage !== undefined) entry.record.errorMessage = patch.errorMessage
    if (wasRunning) {
      const kind = entry.record.kind
      this.inFlight.set(kind, Math.max(0, (this.inFlight.get(kind) ?? 1) - 1))
      this.pump(kind)
    }
    this.notify()
  }

  /**
   * 通知订阅者「台账变了」。
   *
   * 单个订阅者抛错不该影响其他订阅者，更不该把异常送回写入方——一个看界面的连接
   * 不能把任务本身搞挂。
   */
  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error(`[tasks] queue subscriber failed: ${(error as Error).message}`)
      }
    }
  }
}
