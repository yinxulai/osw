import { describe, expect, it, vi } from 'vitest'
import { MAX_QUEUE_TASKS, TaskQueue, type TaskRunContext } from './queue'

/**
 * 队列引擎的用例。
 *
 * 这里只验**生命周期**，不验任何业务：测试用 `thing` 这个假 kind，载荷是一个字符串。
 * 一条用例对应一条承诺（并发真的等于 `concurrency`、取消未开跑的任务一个上游请求都不发、
 * 多 kind 互不干扰…）——接口文档里写的那几句，在这里各有一个断言。
 */

interface Thing {
  id: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** 放行挂起的微任务，让 `run().then(settle)` 落到该落的地方。 */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

interface Scenario {
  queue: TaskQueue
  /** 每一次 `run` 的调用，测试用它数「到底打了几次上游」。 */
  calls: Array<{ id: string; context: TaskRunContext<number>; done: ReturnType<typeof deferred<string>> }>
  run: (payload: Thing, context: TaskRunContext<number>) => Promise<string>
}

/**
 * 一个可控的 kind：每次 `run` 都把 resolve 交出来，由用例决定什么时候、以什么结果收尾。
 *
 * `active` / `maxActive` 是并发断言的唯一依据——引擎的 `inFlight` 是私有的，而这里要验的
 * 恰恰是「同一时刻真的只有 N 个在跑」，不是「它自己记的数是 N」。
 */
interface ScenarioOptions {
  kind?: string
  concurrency?: number
  parse?: (input: unknown) => Thing
}

function scenario(options: ScenarioOptions = {}): Scenario {
  const queue = new TaskQueue()
  const calls: Scenario['calls'] = []
  const run = (payload: Thing, context: TaskRunContext<number>) => {
    const done = deferred<string>()
    calls.push({ id: payload.id, context, done })
    return done.promise
  }
  queue.register({
    kind: options.kind ?? 'thing',
    concurrency: options.concurrency,
    parse: options.parse ?? (input => input as Thing),
    keyOf: payload => payload.id,
    run,
  })
  return { queue, calls, run }
}

function ids(queue: TaskQueue): string[] {
  return queue.snapshot().map(record => record.id)
}

describe('状态机', () => {
  it('queued → running → success，结果与结束时间一起记下', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])

    const [record] = queue.snapshot()
    expect(record).toMatchObject({ kind: 'thing', key: 'a', status: 'running' })
    expect(record.finishedAt).toBeUndefined()

    calls[0].done.resolve('ok')
    await settle()

    expect(queue.snapshot()[0]).toMatchObject({ status: 'success', result: 'ok' })
    expect(queue.snapshot()[0].finishedAt).toEqual(expect.any(Number))
  })

  it('run 抛错 → failed，错误原文留下来', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])

    calls[0].done.reject(new Error('upstream down'))
    await settle()

    expect(queue.snapshot()[0]).toMatchObject({ status: 'failed', errorMessage: 'upstream down' })
  })

  it('run 在返回 promise 之前同步抛错也落到 failed，槽位接着发给下一条', async () => {
    const queue = new TaskQueue()
    const calls: string[] = []
    queue.register({
      kind: 'thing',
      concurrency: 1,
      parse: input => input as Thing,
      keyOf: payload => payload.id,
      run: payload => {
        calls.push(payload.id)
        if (payload.id === 'boom') throw new Error('sync boom')
        return Promise.resolve('ok')
      },
    })

    // 异常不能穿出 enqueue（那会让整批 HTTP 请求失败），而且第一条失败后必须继续发放。
    expect(() => queue.enqueue('thing', [{ id: 'boom' }, { id: 'next' }])).not.toThrow()
    expect(calls).toEqual(['boom', 'next'])

    await settle()
    expect(queue.snapshot()[0]).toMatchObject({ status: 'failed', errorMessage: 'sync boom' })
    expect(queue.snapshot()[1].status).toBe('success')
  })

  it('report 写进 progress；收尾之后不再接受进度（「取消了还在动」那种错觉）', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])

    calls[0].context.report(1)
    expect(queue.snapshot()[0].progress).toBe(1)

    calls[0].done.resolve('ok')
    await settle()

    calls[0].context.report(2)
    expect(queue.snapshot()[0].progress).toBe(1)
  })

  it('快照按入队顺序，且返回的是副本（外面改不动台账）', () => {
    const { queue } = scenario({ concurrency: 2 })
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }])

    expect(queue.snapshot().map(record => record.key)).toEqual(['a', 'b'])
    const snapshot = queue.snapshot()
    snapshot[0].status = 'success'
    expect(queue.snapshot()[0].status).toBe('running')
  })
})

describe('入队与去重', () => {
  it('同 kind 同 key 已在排队 / 运行中时不重复入队（连点两下不该变成两倍计费）', () => {
    const { queue } = scenario()
    expect(queue.enqueue('thing', [{ id: 'a' }])).toEqual({ accepted: 1, skipped: 0 })
    expect(queue.enqueue('thing', [{ id: 'a' }])).toEqual({ accepted: 0, skipped: 1 })
    expect(queue.snapshot()).toHaveLength(1)
  })

  it('上一个同 key 的任务结束后可以再入队（重测）', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])
    calls[0].done.resolve('ok')
    await settle()

    expect(queue.enqueue('thing', [{ id: 'a' }])).toEqual({ accepted: 1, skipped: 0 })
    expect(queue.snapshot()).toHaveLength(2)
  })

  it('逐项判定：同一批里有一项被拒，不影响其余项', () => {
    const { queue } = scenario({
      parse: input => {
        const candidate = input as { id?: unknown }
        if (typeof candidate.id !== 'string') throw new Error('bad payload')
        return { id: candidate.id }
      },
    })

    expect(queue.enqueue('thing', [{ id: 'a' }, { nope: 1 }, { id: 'b' }])).toEqual({ accepted: 2, skipped: 1 })
    expect(queue.snapshot().map(record => record.key)).toEqual(['a', 'b'])
  })

  it('没注册的 kind 整批拒掉，而不是建一堆永远跑不起来的行', () => {
    const { queue } = scenario()
    expect(queue.enqueue('unknown', [{ id: 'a' }, { id: 'b' }])).toEqual({ accepted: 0, skipped: 2 })
    expect(queue.snapshot()).toEqual([])
  })

  it('keyOf 抛错的那一项算 skipped，同批其它项照常入队', () => {
    const queue = new TaskQueue()
    queue.register({
      kind: 'thing',
      parse: input => input as Thing,
      keyOf: payload => {
        if (payload.id === 'bad') throw new Error('cannot key')
        return payload.id
      },
      run: () => new Promise<string>(() => {}),
    })

    expect(() => queue.enqueue('thing', [{ id: 'bad' }, { id: 'good' }])).not.toThrow()
    expect(queue.snapshot().map(record => record.key)).toEqual(['good'])
  })

  it('超过总长上界后拒绝入队，且不会把旧任务挤掉', async () => {
    const { queue, calls } = scenario()
    const items = Array.from({ length: MAX_QUEUE_TASKS + 5 }, (_, index) => ({ id: `t${index}` }))

    expect(queue.enqueue('thing', items)).toEqual({ accepted: MAX_QUEUE_TASKS, skipped: 5 })
    expect(queue.snapshot()).toHaveLength(MAX_QUEUE_TASKS)
    // 旧任务仍在，且第一个已经在跑。
    expect(queue.snapshot()[0]).toMatchObject({ key: 't0', status: 'running' })
    calls[0].done.resolve('ok')
    await settle()
  })
})

describe('并发', () => {
  it('同一时刻在飞的数量真的等于 concurrency（不是分片大小）', async () => {
    const { queue, calls } = scenario({ concurrency: 2 })
    for (let index = 0; index < 5; index += 1) queue.enqueue('thing', [{ id: `t${index}` }])

    expect(calls).toHaveLength(2)
    expect(queue.snapshot().filter(record => record.status === 'running')).toHaveLength(2)

    // 收一个、补一个：谁先空出来谁取下一个，而不是等这一片跑完。
    calls[0].done.resolve('ok')
    await settle()
    expect(calls).toHaveLength(3)
    expect(queue.snapshot().filter(record => record.status === 'running')).toHaveLength(2)

    calls[1].done.resolve('ok')
    calls[2].done.resolve('ok')
    await settle()
    // 两个槽同时空出来，两个队列项一起补上：五个任务全在飞了。
    expect(calls).toHaveLength(5)

    calls[3].done.resolve('ok')
    calls[4].done.resolve('ok')
    await settle()
    expect(queue.snapshot().every(record => record.status === 'success')).toBe(true)
  })

  it('不给 concurrency 时串行（默认 1）', () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }])

    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('a')
  })

  /**
   * 入队时给的并发是**这一次的调度上限**，覆盖 kind 注册时声明的那个。
   *
   * 诊断就是这条的现实版本：kind 声明 1（串行是诚实默认），用户在面板上填 3 就是「这一批
   * 同时打三个上游」。断言用的是 `calls`（真的调了几次 `run`），不是引擎自己记的数。
   */
  it('入队时给的 concurrency 覆盖 kind 声明的默认值，同时在飞恰好等于它', async () => {
    const { queue, calls } = scenario({ concurrency: 1 })
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], { concurrency: 3 })

    expect(calls.map(call => call.id)).toEqual(['a', 'b', 'c'])
    expect(queue.snapshot().filter(record => record.status === 'running')).toHaveLength(3)
    // 上限是 3，不是「全放」：第四个还在排队。
    expect(queue.snapshot()[3].status).toBe('queued')

    // 补位行为不变：谁先空出来谁取下一个。
    calls[0].done.resolve('ok')
    await settle()
    expect(calls.map(call => call.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(queue.snapshot().filter(record => record.status === 'running')).toHaveLength(3)
  })

  it('不给 concurrency 时用 kind 声明的那个，而不是硬编码的 1', () => {
    const { queue, calls } = scenario({ concurrency: 2 })
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])

    expect(calls.map(call => call.id)).toEqual(['a', 'b'])
  })

  /**
   * 不合法的那三个都要落到 1，而不是让整条 kind 停摆或全放。
   *
   * `NaN` 会让 `inFlight < limit` 恒为假（一个都发不出去，且没有任何报错）；`Infinity`
   * 会让「同一时刻在飞的数量等于 concurrency」直接失效；`0` / 负数在 `Math.max(1, …)`
   * 里本来就该抬到 1。三条走的是同一处归一化（`usableConcurrency`），与 kind 声明那一侧
   * 共用——契约层虽然先用 `.int().min(1)` 挡了一道，引擎也不该假定调用方守规矩。
   *
   * 注意 kind 声明的是 5：这里断言的是「非法值把上限改成了 1」，而不是「声明没生效」。
   */
  it('入队时给的 concurrency 不合法时落到 1（NaN / Infinity / 0 / 负数）', () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      const { queue, calls } = scenario({ concurrency: 5 })
      queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], { concurrency: invalid })

      expect(calls.map(call => call.id), `concurrency=${invalid}`).toEqual(['a'])
      expect(queue.snapshot().filter(record => record.status === 'running')).toHaveLength(1)
    }
  })

  /**
   * 并发是 **kind 级**的当前上限，所以同 kind 后一次入队会改写它（last write wins）。
   *
   * 这是设计里写明的语义，不是副作用：调度参数说的是「接下来怎么发牌」，最近一次说的算。
   * 今天诊断是唯一注册的 kind，因此不存在「两次入队抢同一个上限」的实际后果。
   */
  it('同 kind 后一次入队给的上限覆盖前一次（last write wins）', () => {
    const { queue, calls } = scenario({ concurrency: 1 })
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], { concurrency: 1 })
    expect(calls).toHaveLength(1)

    // 同一批还在排队时把它调大：立刻多放两个出去。
    queue.enqueue('thing', [{ id: 'd' }], { concurrency: 3 })
    expect(calls.map(call => call.id)).toEqual(['a', 'b', 'c'])
  })

  it('concurrency 是 0 或负数时按 1 处理（配置写错也不该把队列卡死）', () => {
    const { queue, calls } = scenario({ concurrency: 0 })
    queue.enqueue('thing', [{ id: 'a' }])
    expect(calls).toHaveLength(1)
  })

  it('concurrency 是 NaN 时按 1 处理，而不是整条 kind 永久停摆', async () => {
    // `NaN` 不会被 `??` 接住（它不是 null / undefined），而 `0 < NaN` 恒为假：
    // 修复前这里一个任务都发不出去，队列看着「在排队」，其实再也不会动了。
    const { queue, calls } = scenario({ concurrency: Number.NaN })
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])

    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('a')
    // 「按 1 处理」而不是「停摆」：收一条要接着发下一条。
    calls[0].done.resolve('ok')
    await settle()
    expect(calls.map(call => call.id)).toEqual(['a', 'b'])
  })

  it('concurrency 是 Infinity 时按 1 处理，而不是无上限地全放', () => {
    const { queue, calls } = scenario({ concurrency: Number.POSITIVE_INFINITY })
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])

    expect(calls).toHaveLength(1)
    expect(queue.snapshot().filter(record => record.status === 'running')).toHaveLength(1)
  })
})

describe('取消', () => {
  it('未开跑的直接出队，零上游请求', () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(calls).toHaveLength(1)

    const queued = queue.snapshot().filter(record => record.status === 'queued').map(record => record.id)
    expect(queue.cancel(queued)).toBe(2)

    expect(queue.snapshot().map(record => record.status)).toEqual(['running', 'cancelled', 'cancelled'])
    // 「零上游请求」是这条承诺的全部：calls 仍然只有第一个。
    expect(calls).toHaveLength(1)
  })

  it('在跑的收到信号，由那次运行自己在步边界收尾；结局是 cancelled 不是 failed', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])

    const [running] = queue.snapshot()
    expect(queue.cancel([running.id])).toBe(1)
    expect(calls[0].context.signal.aborted).toBe(true)

    // kind 被信号打断之后可能抛错（中止的 fetch 就这么做），仍然不该算失败。
    calls[0].done.reject(new Error('aborted'))
    await settle()

    expect(queue.snapshot()[0].status).toBe('cancelled')
    expect(queue.snapshot()[0].errorMessage).toBeUndefined()
  })

  it('取消在跑的那个之后，槽位放出来给下一个', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }])

    queue.cancel([ids(queue)[0]])
    calls[0].done.resolve('ok')
    await settle()

    expect(calls).toHaveLength(2)
    expect(queue.snapshot()[1].status).toBe('running')
  })

  it('已经结束的任务再取消是空操作', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])
    calls[0].done.resolve('ok')
    await settle()

    expect(queue.cancel(ids(queue))).toBe(0)
    expect(queue.snapshot()[0].status).toBe('success')
  })

  it('已在取消中的任务不会被再数一次（`cancelled` 不能大于任务总数）', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])

    const runningId = ids(queue)[0]
    expect(queue.cancel([runningId])).toBe(1)
    // `abort()` 不会同步改状态，紧接着的第二次取消（或 cancelKind）仍会看到 running。
    expect(queue.cancel([runningId])).toBe(0)
    expect(queue.cancelKind('thing')).toBe(0)

    calls[0].done.reject(new Error('aborted'))
    await settle()
    expect(queue.snapshot()[0].status).toBe('cancelled')
  })

  it('cancelKind 只碰这个 kind', async () => {
    const { queue } = scenario({ kind: 'a' })
    queue.register({
      kind: 'b',
      parse: input => input as Thing,
      keyOf: payload => payload.id,
      run: () => new Promise<string>(() => {}),
    })
    queue.enqueue('a', [{ id: 'a1' }, { id: 'a2' }])
    queue.enqueue('b', [{ id: 'b1' }])

    expect(queue.cancelKind('a')).toBe(2)
    expect(queue.snapshot().filter(record => record.kind === 'b').map(record => record.status)).toEqual(['running'])
  })
})

describe('clear', () => {
  it('有任务在跑时不再整条空操作：终态项照清，在跑 / 排队的一条不少', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'done' }])
    calls[0].done.resolve('ok')
    await settle()
    // 串行 kind：`busy` 顶上槽位，`waiting` 留在队列里。
    queue.enqueue('thing', [{ id: 'busy' }, { id: 'waiting' }])

    const [done, busy, waiting] = queue.snapshot()
    expect([done.status, busy.status, waiting.status]).toEqual(['success', 'running', 'queued'])

    expect(queue.clear()).toBe(1)

    // 旧实现那条守卫防的是「在跑的行凭空消失」；这条承诺原样保留，只是改由「逐条跳过
    // 活任务」来兑现——比整条空操作精确：终态项清了，活任务一条不少。
    expect(ids(queue)).toEqual([busy.id, waiting.id])
    expect(queue.isRunning()).toBe(true)
  })

  it('三种终态都算可清的：成功 / 失败 / 取消一并清掉，返回值就是实际条数', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'ok' }, { id: 'boom' }, { id: 'stop' }, { id: 'busy' }])

    calls[0].done.resolve('ok')
    await settle()
    calls[1].done.reject(new Error('upstream down'))
    await settle()

    // 第三条在跑：取消它，让它在步边界自己收尾成 `cancelled`（独立结局，不是失败）。
    const stopId = queue.snapshot().find(record => record.key === 'stop')!.id
    expect(queue.cancel([stopId])).toBe(1)
    calls[2].done.reject(new Error('aborted'))
    await settle()

    expect(queue.snapshot().map(record => record.status)).toEqual(['success', 'failed', 'cancelled', 'running'])
    expect(queue.clear()).toBe(3)
    expect(queue.snapshot().map(record => record.status)).toEqual(['running'])
  })

  it('端到端解锁：台账灌满、新入队被拒之后，在跑的情况下 clear 一次就能重新入队', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', Array.from({ length: MAX_QUEUE_TASKS }, (_, index) => ({ id: `fill_${index}` })))
    expect(queue.snapshot()).toHaveLength(MAX_QUEUE_TASKS)

    // 让两条真的跑完：既要「此刻有任务在跑」，也要台账里有终态项可清。
    calls[0].done.resolve('ok')
    await settle()
    calls[1].done.resolve('ok')
    await settle()

    // 满额：新入队被拒，一条都进不来。
    expect(queue.enqueue('thing', [{ id: 'late' }])).toEqual({ accepted: 0, skipped: 1 })

    // 旧实现在这里返回 0（有任务在跑 → 整条空操作），额度永远腾不出来，队列就此锁死。
    expect(queue.isRunning()).toBe(true)
    expect(queue.clear()).toBe(2)

    // 解锁：同一个载荷现在进得去。
    expect(queue.enqueue('thing', [{ id: 'late' }])).toEqual({ accepted: 1, skipped: 0 })
  })

  it('没有在跑的时清掉终态项', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])
    calls[0].done.resolve('ok')
    await settle()

    expect(queue.clear()).toBe(1)
    expect(queue.snapshot()).toEqual([])
  })
})

describe('多 kind 互不干扰', () => {
  it('并发上限、去重键、取消都按 kind 各算各的', async () => {
    const queue = new TaskQueue()
    const calls: string[] = []
    let alphaResolve = () => {}
    for (const kind of ['alpha', 'beta']) {
      queue.register({
        kind,
        concurrency: 1,
        parse: input => input as Thing,
        keyOf: payload => payload.id,
        run: payload => {
          calls.push(`${kind}:${payload.id}`)
          return new Promise<string>(resolve => {
            if (kind === 'alpha') alphaResolve = () => resolve('ok')
          })
        },
      })
    }

    // 同 key 在两个 kind 里是两条独立的任务：key 只在 kind 内唯一。
    queue.enqueue('alpha', [{ id: 'x' }])
    queue.enqueue('beta', [{ id: 'x' }])

    expect(calls).toEqual(['alpha:x', 'beta:x'])
    expect(queue.snapshot()).toHaveLength(2)

    expect(queue.cancelKind('alpha')).toBe(1)
    // 在跑的那条要等它自己收尾——引擎只发信号，不替 kind 编一个结局。
    expect(calls).toEqual(['alpha:x', 'beta:x'])
    alphaResolve()
    await settle()
    expect(queue.snapshot().map(record => record.status)).toEqual(['cancelled', 'running'])
  })

  it('一个 kind 卡住不影响另一个 kind 发放', () => {
    const queue = new TaskQueue()
    const calls: string[] = []
    queue.register({
      kind: 'slow',
      parse: input => input as Thing,
      keyOf: payload => payload.id,
      run: payload => {
        calls.push(`slow:${payload.id}`)
        return new Promise<string>(() => {})
      },
    })
    queue.register({
      kind: 'fast',
      concurrency: 2,
      parse: input => input as Thing,
      keyOf: payload => payload.id,
      run: payload => {
        calls.push(`fast:${payload.id}`)
        return Promise.resolve('ok')
      },
    })

    queue.enqueue('slow', [{ id: '1' }, { id: '2' }])
    queue.enqueue('fast', [{ id: '1' }, { id: '2' }, { id: '3' }])

    expect(calls).toEqual(['slow:1', 'fast:1', 'fast:2'])
  })
})

describe('订阅', () => {
  it('每次写入都通知一次；退订后不再收到', async () => {
    const { queue, calls } = scenario()
    const listener = vi.fn()
    const unsubscribe = queue.subscribe(listener)

    queue.enqueue('thing', [{ id: 'a' }])
    expect(listener).toHaveBeenCalledTimes(1)

    calls[0].context.report(1)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    calls[0].done.resolve('ok')
    await settle()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('一个订阅者抛错不影响其它订阅者，也不影响任务本身', async () => {
    const { queue, calls } = scenario()
    const healthy = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    queue.subscribe(() => { throw new Error('viewer broke') })
    queue.subscribe(healthy)

    queue.enqueue('thing', [{ id: 'a' }])
    calls[0].done.resolve('ok')
    await settle()

    expect(healthy).toHaveBeenCalled()
    expect(queue.snapshot()[0].status).toBe('success')
  })
})

describe('isRunning', () => {
  it('有在跑的就是 true，全部结束就是 false', async () => {
    const { queue, calls } = scenario()
    queue.enqueue('thing', [{ id: 'a' }])
    expect(queue.isRunning()).toBe(true)

    calls[0].done.resolve('ok')
    await settle()
    expect(queue.isRunning()).toBe(false)
  })
})
