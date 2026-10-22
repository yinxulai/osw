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

  it('concurrency 是 0 或负数时按 1 处理（配置写错也不该把队列卡死）', () => {
    const { queue, calls } = scenario({ concurrency: 0 })
    queue.enqueue('thing', [{ id: 'a' }])
    expect(calls).toHaveLength(1)
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
  it('有任务在跑时整条空操作（那条在跑的行不该凭空消失）', () => {
    const { queue } = scenario()
    queue.enqueue('thing', [{ id: 'a' }, { id: 'b' }])

    expect(queue.clear()).toBe(0)
    expect(queue.snapshot()).toHaveLength(2)
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
