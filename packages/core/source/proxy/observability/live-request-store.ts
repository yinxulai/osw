import type {
  LiveRequest,
  LiveRequestCandidate,
  LiveRequestEvent,
  LiveRequestEventLevel,
  LiveRequestPhase,
  LiveRequestAttempt,
  Protocol,
  RequestStatus,
  TransportKind,
} from '@common/schemas'
import type { UpstreamTarget } from '@server/proxy/contracts'

/**
 * 进行中请求的内存台账。
 *
 * ## 它解决什么问题
 *
 * 请求日志是**落库的结论**：一个请求只有等它结束（成功 / 失败 / 取消）才会有完整的一行。
 * 在此之前，界面能看到的只有一条 `pending` 的骨架，看不出这次请求路由到了谁、上游回了没有、
 * 数据流到哪一步。而「正在发生」恰恰是排障时最想知道的那一段——一个卡住 30 秒的请求，
 * 是卡在路由、建连、还是上游迟迟不回第一个字节，只有实时状态能回答。
 *
 * ## 边界（为什么它只活在这里）
 *
 * - **它不是第二份真相。** 请求一落定，这个对象就被丢弃，之后一切以数据库为准：保留期、
 *   统计、导出读的都是库里的行。这里只补上「库还没有、但已经在发生」的那一段。
 * - **不落库、不参与任何持久化。** 进程退出即消失，这是刻意的：内存态的东西没有恢复语义，
 *   假装它能恢复只会制造「重启后日志里少了一半」这种无法归因的现象。
 * - **有界。** 每个请求的事件与尝试数量都封顶，已结束的请求只短暂保留，防止长跑进程
 *   在这一份调试用途的数据上无上限增长。
 *
 * 只被代理进程内的两个点写：请求入口（路由决策、拒绝、收尾）与尝试观察者（数据流）。
 * 管理接口只读。
 */

/** 单个请求保留的事件条数上限：超出后丢最旧的，时间轴仍保留最近的一段。 */
const MAX_EVENTS_PER_REQUEST = 200
/**
 * 每条分块预览保留的字符数：只看开头长什么样，超出部分以 `…` 收尾。
 *
 * 80 是照「界面上一行能读完」定的：预览用 11px 等宽字排在时间轴最右那一列，
 * 常见窗口下大约能显示 100 个字符，留出余量取 80。再多就只是让读者去数被截断的尾巴——
 * 这一段本来也不参与统计与落库，存下来的每个字符都可能被看到，看不到的部分就不该存。
 */
const MAX_CHUNK_PREVIEW_CHARACTERS = 80
/** 已结束请求在内存里保留的条数上限。 */
const MAX_SETTLED_REQUESTS = 50
/** 已结束请求在内存里保留的时长：够界面看到「刚刚结束」，又不至于一直占着。 */
const SETTLED_TTL_MILLISECONDS = 60_000

interface LiveRequestRecord {
  id: string
  status: RequestStatus
  phase: LiveRequestPhase
  logicalModelId: string | null
  clientProtocol: Protocol | null
  transport: TransportKind
  method: string
  path: string
  startedAt: number
  updatedAt: number
  endedAt: number | null
  candidates: LiveRequestCandidate[]
  attempts: LiveRequestAttempt[]
  events: LiveRequestEvent[]
}

/** 登记一次新请求时已知的东西：身份、入口方法与路径、形态。 */
export interface LiveRequestBeginInput {
  id: string
  method: string
  path: string
  transport: TransportKind
  clientProtocol: Protocol | null
}

/** 路由决策的结论。`logicalModelId` 为 `null` 表示落点还没算出来就失败了。 */
export interface LiveRouteResolution {
  logicalModelId: string | null
  clientProtocol: Protocol | null
  transport: TransportKind
  candidates: readonly UpstreamTarget[]
}

/**
 * 一次进行中尝试的写口。观察者拿到它就够了——它不需要知道台账是怎么存的。
 */
export interface LiveAttemptHandle {
  /** 局部更新尝试行。 */
  patch(patch: Partial<LiveRequestAttempt>): void
  /**
   * 记一段从上游读到的字节，并把**这一个**分块开头的那几个字存成当前预览。
   *
   * 字节数是真的（累加），预览是**采样**且只留最新的一条：这里要回答的是「上游此刻在回什么」，
   * 不是「这一路回了些什么」。后者等价于把整段正文在内存里再存一份，而这一份数据连落库都不参与。
   *
   * 旧预览直接被覆写，不排队。因此突发一串分块时，界面上看到的一定是最后那一个——
   * 断流时留在屏上的也是它，正是排障最需要的那个现场。最长保留
   * `MAX_CHUNK_PREVIEW_CHARACTERS` 个字符（够读开头，又不至于超出界面那一行的宽度）。
   */
  addUpstreamChunk(bytes: number, preview: string): void
  /** 记一段写给客户端的字节。 */
  addDownstreamBytes(bytes: number): void
}

/** 请求级身份字段的局部更新；只更新传入的那些。 */
export interface LiveIdentityPatch {
  logicalModelId?: string | null
  clientProtocol?: Protocol | null
  transport?: TransportKind
}

/** 一次进行中请求的写口。 */
export interface LiveRequestHandle {
  /** 就地把这次请求标成某个阶段。 */
  setPhase(phase: LiveRequestPhase): void
  /** 记一条时间线事件。 */
  pushEvent(kind: string, level: LiveRequestEventLevel, detail?: Record<string, string | number | boolean>): void
  /** 更新请求级身份字段（协议、形态、逻辑模型），不产生事件。 */
  update(patch: LiveIdentityPatch): void
  /** 落下路由结论：逻辑模型、协议、形态与候选顺序。 */
  resolveRoute(resolution: LiveRouteResolution): void
  /**
   * 开始一次尝试，返回它的写口。
   *
   * 尝试行在这一刻才存在，所以它的起点是 `connecting`，而不是「已排队」——台账里没有
   * 一行代表「将要尝试」。
   */
  startAttempt(target: UpstreamTarget): LiveAttemptHandle
  /** 收尾：写入结局并把它移出「进行中」。 */
  settle(status: RequestStatus, kind: string, level: LiveRequestEventLevel, detail?: Record<string, string | number | boolean>): void
}

/**
 * 进行中请求台账。
 *
 * 单例即可：一个进程就是一套代理，不存在「同一请求属于哪个台账」的问题。并发安全不靠锁——
 * Node 是单线程的，每个写方法都在一次同步执行里完成，不存在交错。
 */
export class LiveRequestStore {
  private readonly active = new Map<string, LiveRequestRecord>()
  /** 已结束的请求，最近结束的在前。 */
  private settled: LiveRequest[] = []
  /** 写入订阅者。推送通道靠它把「台账变了」变成「推一帧」，而不是自己去轮询。 */
  private readonly listeners = new Set<() => void>()

  /**
   * 订阅台账的每一次写入。返回退订函数。
   *
   * 回调是**同步**的且可能在任意一次写入中触发，因此订阅者只该做一件事：把「脏了」记下来，
   * 真正的快照与推送留给自己的定时器。这样写入方的耗时与订阅者的数量、是否联网完全无关——
   * 代理绝不能因为没人看界面就变快，也绝不能因为界面在看就变慢。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 登记一次新请求。同 id 重复登记时以新的为准（请求 id 由 `generateId` 保证唯一）。 */
  begin(input: LiveRequestBeginInput): LiveRequestHandle {
    const now = Date.now()
    const record: LiveRequestRecord = {
      id: input.id,
      status: 'pending',
      phase: 'routing',
      logicalModelId: null,
      clientProtocol: input.clientProtocol,
      transport: input.transport,
      method: input.method,
      path: input.path,
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      candidates: [],
      attempts: [],
      events: [],
    }
    this.active.set(record.id, record)
    this.prune()
    this.notify()
    return this.handleFor(record)
  }

  /** 读取一个请求的快照；不存在（还没开始或已过期）时为 `null`。 */
  get(id: string): LiveRequest | null {
    const active = this.active.get(id)
    if (active) return snapshotOf(active)
    this.prune()
    return this.settled.find(request => request.id === id) ?? null
  }

  /**
   * 全部快照：进行中的在前（按开始时间倒序），随后是刚结束的（按结束时间倒序）。
   *
   * 界面只关心「有没有正在跑的」，但把刚结束的也带上，是为了让一条请求从进行中变成
   * 结束时不至于凭空消失——用同一个列表渲染，界面上就是状态自己变了颜色。
   */
  list(): LiveRequest[] {
    this.prune()
    const active = [...this.active.values()]
      .sort((left, right) => right.startedAt - left.startedAt)
      .map(snapshotOf)
    return [...active, ...this.settled]
  }

  /** 清空台账。测试用。 */
  clear(): void {
    this.active.clear()
    this.settled = []
  }

  /**
   * 通知订阅者「台账变了」。
   *
   * 单个订阅者抛错不该影响其他订阅者，更不该把异常送回写入方——写台账是代理的关键路径，
   * 一个看界面的连接不能把请求搞挂。
   */
  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error(`[proxy] live request subscriber failed: ${(error as Error).message}`)
      }
    }
  }

  private handleFor(record: LiveRequestRecord): LiveRequestHandle {
    /** 所有写入的收口：更新时间戳并告诉订阅者。 */
    const touch = () => {
      record.updatedAt = Date.now()
      this.notify()
    }
    return {
      setPhase: phase => {
        record.phase = phase
        touch()
      },
      pushEvent: (kind, level, detail) => {
        appendEvent(record, kind, level, detail)
        this.notify()
      },
      update: patch => {
        if (patch.logicalModelId !== undefined) record.logicalModelId = patch.logicalModelId
        if (patch.clientProtocol !== undefined) record.clientProtocol = patch.clientProtocol
        if (patch.transport !== undefined) record.transport = patch.transport
        touch()
      },
      resolveRoute: ({ logicalModelId, clientProtocol, transport, candidates }) => {
        record.logicalModelId = logicalModelId
        record.clientProtocol = clientProtocol
        record.transport = transport
        record.candidates = candidates.map(target => ({
          providerId: target.providerId,
          providerName: target.providerName,
          providerModelId: target.providerModelId,
          providerModelName: target.providerModelName,
        }))
        appendEvent(record, 'route.resolved', 'info', {
          logicalModelId: logicalModelId ?? 'none',
          candidates: record.candidates.length,
        })
        this.notify()
      },
      startAttempt: target => {
        const startedAt = Date.now()
        const attempt: LiveRequestAttempt = {
          index: record.attempts.length,
          providerId: target.providerId,
          providerName: target.providerName,
          providerModelId: target.providerModelId,
          providerModelName: target.providerModelName,
          endpointProtocol: target.protocol,
          url: target.url,
          state: 'connecting',
          httpStatus: null,
          upstreamTransport: null,
          // 真实字节数要等请求修改器跑完，由执行器随状态一起补齐；命中的修改器名字也一起补。
          requestBytes: 0,
          requestRewriteRuleNames: [],
          upstreamBytes: 0,
          downstreamBytes: 0,
          chunkCount: 0,
          chunkPreview: null,
          ttftMilliseconds: null,
          inputTokens: null,
          outputTokens: null,
          errorCode: null,
          errorMessage: null,
          startedAt,
          endedAt: null,
        }
        record.attempts.push(attempt)
        record.phase = 'connecting'
        appendEvent(record, 'attempt.start', 'info', {
          index: attempt.index,
          providerModelName: attempt.providerModelName,
        })
        this.notify()
        return {
          patch: patch => {
            Object.assign(attempt, patch)
            touch()
          },
          addUpstreamChunk: (bytes, preview) => {
            attempt.upstreamBytes += bytes
            attempt.chunkCount += 1
            attempt.chunkPreview = preview.length > MAX_CHUNK_PREVIEW_CHARACTERS ? `${preview.slice(0, MAX_CHUNK_PREVIEW_CHARACTERS)}…` : preview
            touch()
          },
          addDownstreamBytes: bytes => {
            attempt.downstreamBytes += bytes
            touch()
          },
        }
      },
      settle: (status, kind, level, detail) => {
        // 收尾只认第一次：请求一旦落定，后面的收尾调用一律忽略。执行器、客户端断开、
        // 上游失败三条路径都可能各自走到「结束」，而一个请求只能有一个结局。
        if (record.endedAt !== null) return
        record.status = status
        record.phase = 'settled'
        record.endedAt = Date.now()
        appendEvent(record, kind, level, detail)
        this.retire(record)
        this.notify()
      },
    }
  }

  /** 把一个已落定的请求从「进行中」搬到保留区。 */
  private retire(record: LiveRequestRecord): void {
    this.active.delete(record.id)
    this.settled.unshift(snapshotOf(record))
    this.prune()
  }

  /**
   * 丢弃过期的已结束请求。
   *
   * 两个上限都在这里执行：条数（保留区容量）与时长（`SETTLED_TTL_MILLISECONDS`）。
   * 时长按请求自己的结束时刻算，与进程跑了多久无关。
   */
  private prune(): void {
    const deadline = Date.now() - SETTLED_TTL_MILLISECONDS
    // 保留区里只放已经结束的请求，因此 `endedAt` 必然在；那个兼底只为了满足类型。
    this.settled = this.settled.filter(request => (request.endedAt ?? request.updatedAt) >= deadline)
    if (this.settled.length > MAX_SETTLED_REQUESTS) this.settled.length = MAX_SETTLED_REQUESTS
  }
}

export const liveRequestStore = new LiveRequestStore()

/** 往时间轴上追加一条事件，并按上限裁掉最旧的那几条。 */
function appendEvent(record: LiveRequestRecord, kind: string, level: LiveRequestEventLevel, detail?: Record<string, string | number | boolean>): void {
  const at = Date.now()
  record.events.push({
    at,
    offsetMilliseconds: at - record.startedAt,
    kind,
    level,
    detail: detail ?? null,
  })
  if (record.events.length > MAX_EVENTS_PER_REQUEST) record.events.splice(0, record.events.length - MAX_EVENTS_PER_REQUEST)
  record.updatedAt = at
}

/**
 * 深拷贝一份对外快照。
 *
 * 拷贝而不是直接交出去：台账内部的对象会被后续事件继续改写，而界面拿到的那一份必须是
 * 「某一刻的事实」。序列化时也不该出现「读到一半被改了」的数组。
 */
function snapshotOf(record: LiveRequestRecord): LiveRequest {
  return {
    id: record.id,
    status: record.status,
    phase: record.phase,
    logicalModelId: record.logicalModelId,
    clientProtocol: record.clientProtocol,
    transport: record.transport,
    method: record.method,
    path: record.path,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    endedAt: record.endedAt,
    candidates: record.candidates.map(candidate => ({ ...candidate })),
    attempts: record.attempts.map(attempt => ({ ...attempt })),
    events: record.events.map(event => ({ ...event, detail: event.detail === null ? null : { ...event.detail } })),
  }
}
