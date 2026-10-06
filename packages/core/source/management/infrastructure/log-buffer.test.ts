import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 运行日志缓冲是**日志的唯一入口**：宿主进程的 console 转发、服务进程自己的 `console.*`、
 * 以及探针直接调的 `writeRuntimeLog` 都从这里出去。所以这里要验的是三条不变量：
 *
 * 1. 写进来的每一条都留在内存里（数据库只是它的持久化副本，不是它的替代品）；
 * 2. 数据库不可用时**采集不中断**——先攒着，等库回来再补；
 * 3. 上限与保留期只在这里定义一次，重复调 `installLogCapture()` 不会叠出第二层拦截。
 *
 * 模块级状态（内存数组、待补队列、上次清理时间）跟着模块走，所以每个用例都重新取一份模块：
 * 共用一份会让上个用例写下的日志漏进下个用例的断言里。
 */
const state = vi.hoisted(() => ({
  persistFails: false,
  clearFails: false,
  listFails: false,
  created: [] as Array<{ level: string; message: string; timestamp: number }>,
  cleared: 0,
  pruned: [] as number[],
  dbLogs: [] as Array<{ id: number; level: string; message: string; timestamp: number }>,
  dbAllLogs: [] as Array<{ id: number; level: string; message: string; timestamp: number }>,
  dbPaged: { logs: [] as Array<{ id: number; level: string; message: string; timestamp: number }>, total: 0 },
}))

vi.mock('@server/database/runtime-log-store', () => ({
  createRuntimeLog: (level: string, message: string, timestamp: number) => {
    if (state.persistFails) throw new Error('database is down')
    state.created.push({ level, message, timestamp })
    return { id: state.created.length, level, message, timestamp }
  },
  listRuntimeLogs: () => {
    if (state.listFails) throw new Error('database is down')
    return state.dbLogs
  },
  listRuntimeLogsPaged: () => {
    if (state.listFails) throw new Error('database is down')
    return state.dbPaged
  },
  listAllRuntimeLogs: () => {
    if (state.listFails) throw new Error('database is down')
    return state.dbAllLogs
  },
  clearRuntimeLogs: () => {
    if (state.clearFails) throw new Error('database is down')
    state.cleared += 1
  },
  pruneRuntimeLogsBefore: (days: number) => {
    state.pruned.push(days)
    return 0
  },
}))

let buffer: typeof import('./log-buffer')
let originalConsole: { log: unknown; info: unknown; warn: unknown; error: unknown; debug: unknown }

beforeEach(async () => {
  vi.useFakeTimers()
  // 基准时刻取一个够大的值：`lastPruneTime` 初值为 0，用小数值会让「首次写入是否触发清理」
  // 这件事在真时钟下变得不成立。
  vi.setSystemTime(1_700_000_000_000)
  state.persistFails = false
  state.clearFails = false
  state.listFails = false
  state.created.length = 0
  state.cleared = 0
  state.pruned.length = 0
  state.dbLogs = []
  state.dbAllLogs = []
  state.dbPaged = { logs: [], total: 0 }
  vi.resetModules()
  buffer = await import('./log-buffer')
})

afterEach(() => {
  if (originalConsole) {
    console.log = originalConsole.log as typeof console.log
    console.info = originalConsole.info as typeof console.info
    console.warn = originalConsole.warn as typeof console.warn
    console.error = originalConsole.error as typeof console.error
    console.debug = originalConsole.debug as typeof console.debug
    originalConsole = undefined as never
  }
  vi.useRealTimers()
})

describe('log-buffer 的写入', () => {
  it('写进来的一条同时进内存与数据库，时间戳默认取当下', () => {
    buffer.writeRuntimeLog('warn', 'upstream timed out')

    expect(state.created).toEqual([{ level: 'warn', message: 'upstream timed out', timestamp: 1_700_000_000_000 }])
    // 内存那一份要绕开数据库才看得见：库在的时候读取走库（下面有单独的用例）。
    state.listFails = true
    expect(buffer.listLogs()).toHaveLength(1)
  })

  // 时间戳可以显式给：主进程写下的日志发生在服务起来之前，等它送到时 `Date.now()` 已经晚了。
  it('调用方给了时间戳就用调用方的', () => {
    buffer.writeRuntimeLog('info', 'boot banner', 1_699_000_000_000)

    expect(state.created[0]?.timestamp).toBe(1_699_000_000_000)
  })

  // 「数据库不可用」是这里唯一需要扛住的故障：日志采集自己不能因为日志存不进去而中断。
  it('落库失败时留在待补队列里，下一次写入先把旧的补上', () => {
    state.persistFails = true
    buffer.writeRuntimeLog('error', 'first')
    buffer.writeRuntimeLog('error', 'second')
    expect(state.created).toEqual([])

    state.persistFails = false
    buffer.writeRuntimeLog('info', 'third')

    // 补写按原顺序：first、second，然后才是本次的 third。
    expect(state.created.map(entry => entry.message)).toEqual(['first', 'second', 'third'])
  })

  it('补写成功后不重复写第二遍', () => {
    state.persistFails = true
    buffer.writeRuntimeLog('warn', 'pending one')

    state.persistFails = false
    buffer.writeRuntimeLog('info', 'a')
    buffer.writeRuntimeLog('info', 'b')

    expect(state.created.filter(entry => entry.message === 'pending one')).toHaveLength(1)
  })

  // 待补队列只在下一次写入时才排空：中途库一直没好，队列就一直是那几条，不多不少。
  it('库一直不好的话队列里只留最初的几条，不会被读取动作悄悄冲掉', () => {
    state.persistFails = true
    buffer.writeRuntimeLog('error', 'only')

    state.listFails = true
    expect(buffer.listLogs().map(entry => entry.message)).toEqual(['only'])
    expect(state.created).toEqual([])
  })

  it('内存缓冲只留最近 5000 条，最旧的先走', () => {
    for (let index = 0; index < 5_010; index += 1) buffer.writeRuntimeLog('info', `line ${index}`, 1_700_000_000_000 + index)
    state.listFails = true

    const logs = buffer.listLogs({ limit: 10_000 })
    expect(logs).toHaveLength(5_000)
    // 回退路径给的是「最新的在前」。
    expect(logs[0]?.message).toBe('line 5009')
    expect(logs.some(entry => entry.message === 'line 9')).toBe(false)
    expect(logs[logs.length - 1]?.message).toBe('line 10')
  })

  // 保留期清理不是每写一条都跑：`DELETE` 有成本，一分钟一次足够。
  it('过期日志的清理一分钟最多触发一次，且按 3 天保留', () => {
    buffer.writeRuntimeLog('info', 'a')
    expect(state.pruned).toEqual([3])

    vi.setSystemTime(1_700_000_000_000 + 59_999)
    buffer.writeRuntimeLog('info', 'b')
    expect(state.pruned).toEqual([3])

    vi.setSystemTime(1_700_000_000_000 + 60_000)
    buffer.writeRuntimeLog('info', 'c')
    expect(state.pruned).toEqual([3, 3])
  })
})

describe('log-buffer 的读取', () => {
  it('数据库可用时直接用它给的结果', () => {
    state.dbLogs = [{ id: 7, level: 'warn', message: 'from db', timestamp: 1 }]
    state.listFails = false

    expect(buffer.listLogs()).toBe(state.dbLogs)
  })

  it('数据库不可用时回退到内存，默认 500 条且最新的在前', () => {
    for (let index = 0; index < 520; index += 1) buffer.writeRuntimeLog('info', `line ${index}`, 1_700_000_000_000 + index)
    state.listFails = true

    const logs = buffer.listLogs()
    expect(logs).toHaveLength(500)
    expect(logs[0]?.message).toBe('line 519')
    expect(logs[logs.length - 1]?.message).toBe('line 20')
  })

  it('回退路径也认 after 与 limit', () => {
    const first = buffer.listLogs() // 先确保模块就绪
    expect(first).toEqual([])
    buffer.writeRuntimeLog('info', 'one')
    const afterId = (buffer.listLogs()[0]?.id ?? 0) - 1
    buffer.writeRuntimeLog('info', 'two')
    buffer.writeRuntimeLog('info', 'three')
    state.listFails = true

    const logs = buffer.listLogs({ after: afterId, limit: 1 })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toBe('three')
  })

  it('分页查询走数据库', () => {
    state.dbPaged = { logs: [{ id: 3, level: 'error', message: 'boom', timestamp: 1 }], total: 1 }

    expect(buffer.listLogsPaged(20, 0)).toBe(state.dbPaged)
  })

  it('分页回退按级别与关键字过滤，关键字不区分大小写', () => {
    buffer.writeRuntimeLog('info', 'Upstream OK')
    buffer.writeRuntimeLog('error', 'Upstream Failed')
    buffer.writeRuntimeLog('warn', 'client gone')
    state.listFails = true

    const byLevel = buffer.listLogsPaged(50, 0, { level: 'error' })
    expect(byLevel.logs.map(entry => entry.message)).toEqual(['Upstream Failed'])
    expect(byLevel.total).toBe(1)

    const byQuery = buffer.listLogsPaged(50, 0, { query: 'upstream' })
    expect(byQuery.logs.map(entry => entry.message)).toEqual(['Upstream Failed', 'Upstream OK'])
    expect(byQuery.total).toBe(2)

    const both = buffer.listLogsPaged(50, 0, { level: 'info', query: 'upstream' })
    expect(both.logs.map(entry => entry.message)).toEqual(['Upstream OK'])
  })

  // 分页的两段口径必须一致：limit/offset 切的是过滤后的那一份，total 也是过滤后的总数，
  // 否则界面上的「第 2 页」会落在另一批数据上。
  it('分页回退的 offset 与 total 都按过滤后的结果算', () => {
    for (let index = 0; index < 5; index += 1) buffer.writeRuntimeLog('info', `hit ${index}`)
    buffer.writeRuntimeLog('warn', 'miss')
    state.listFails = true

    const page = buffer.listLogsPaged(2, 2, { query: 'hit' })
    expect(page.total).toBe(5)
    expect(page.logs.map(entry => entry.message)).toEqual(['hit 2', 'hit 1'])
  })
})

describe('log-buffer 的清理与导出', () => {
  it('清空同时清内存与数据库', () => {
    buffer.writeRuntimeLog('info', 'to be cleared')
    buffer.clearLogs()

    expect(state.cleared).toBe(1)
    expect(buffer.listLogs()).toEqual([])
  })

  // 隔离测试里数据库往往还没初始化，清空不该因此抛出去。
  it('数据库还没起来时清空也不抛', () => {
    state.clearFails = true
    expect(() => buffer.clearLogs()).not.toThrow()
  })

  it('导出优先用数据库里的全量，数据库不可用才用内存', () => {
    buffer.writeRuntimeLog('info', 'in memory', 1_700_000_000_000)
    state.dbAllLogs = [{ id: 1, level: 'error', message: 'from db', timestamp: 0 }]

    expect(buffer.exportLogs()).toBe('[1970-01-01T00:00:00.000Z] [ERROR] from db')

    state.listFails = true
    expect(buffer.exportLogs()).toBe('[2023-11-14T22:13:20.000Z] [INFO] in memory')
  })

  it('导出的每一行是「时间 + 级别 + 正文」，按写入顺序', () => {
    buffer.writeRuntimeLog('warn', 'first line', 1_700_000_000_000)
    buffer.writeRuntimeLog('debug', 'second line', 1_700_000_001_000)
    state.listFails = true

    expect(buffer.exportLogs().split('\n')).toEqual([
      '[2023-11-14T22:13:20.000Z] [WARN] first line',
      '[2023-11-14T22:13:21.000Z] [DEBUG] second line',
    ])
  })

  it('没有日志可导时给一个空字符串，不是一行空白', () => {
    state.listFails = true
    expect(buffer.exportLogs()).toBe('')
  })
})

describe('installLogCapture 的拦截', () => {
  /** 把五路 console 换成探针再安装拦截，这样「有没有继续往原出口写」也能验。 */
  async function installWithProbes() {
    originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
    const probes = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    console.log = probes.log as never
    console.info = probes.info as never
    console.warn = probes.warn as never
    console.error = probes.error as never
    console.debug = probes.debug as never

    vi.resetModules()
    const fresh = await import('./log-buffer')
    fresh.installLogCapture()
    return { fresh, probes }
  }

  it('五路 console 都写进缓冲，并且照旧往原出口输出', async () => {
    const { probes } = await installWithProbes()

    console.log('a')
    console.info('b')
    console.warn('c')
    console.error('d')
    console.debug('e')

    expect(state.created.map(entry => [entry.level, entry.message])).toEqual([
      ['info', 'a'],
      ['info', 'b'],
      ['warn', 'c'],
      ['error', 'd'],
      ['debug', 'e'],
    ])
    // 原出口一次都不能少：拦截是为了多存一份，不是为了改掉终端上的输出。
    expect(probes.log).toHaveBeenCalledWith('a')
    expect(probes.info).toHaveBeenCalledWith('b')
    expect(probes.warn).toHaveBeenCalledWith('c')
    expect(probes.error).toHaveBeenCalledWith('d')
    expect(probes.debug).toHaveBeenCalledWith('e')
  })

  // 服务进程可能在多个入口各装一次（宿主、管理面、探针），装两次会写两遍。
  it('重复安装不会叠出第二层拦截', async () => {
    const { fresh } = await installWithProbes()

    fresh.installLogCapture()
    fresh.installLogCapture()
    console.log('once')

    expect(state.created).toEqual([{ level: 'info', message: 'once', timestamp: 1_700_000_000_000 }])
  })

  it('参数按空格拼成人能读的一行：字符串原样、对象转 JSON', async () => {
    await installWithProbes()

    console.log('provider', 3, { enabled: true })

    expect(state.created[0]?.message).toBe('provider 3 {"enabled":true}')
  })

  it('错误取 stack，循环引用不炸', async () => {
    await installWithProbes()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    console.error(new Error('upstream refused'))
    console.log(circular)

    expect(state.created[0]?.message.startsWith('Error: upstream refused')).toBe(true)
    // `JSON.stringify` 抛出去的话整条日志就丢了，所以退到 `String(arg)`。
    expect(state.created[1]?.message).toBe('[object Object]')
  })
})
