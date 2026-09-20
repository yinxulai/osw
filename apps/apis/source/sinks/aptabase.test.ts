import { describe, expect, it, vi } from 'vitest'
import { TELEMETRY_MAX_EVENTS_PER_BATCH, type TelemetryEvent } from '@common/telemetry'
import {
  APTABASE_EVENTS_URL,
  APTABASE_MAX_EVENT_AGE_MILLISECONDS,
  APTABASE_MAX_EVENTS_PER_REQUEST,
  createAptabaseSink,
  timestampOf,
  type AptabaseEvent,
} from './aptabase'
import { FORWARD_TIMEOUT_MILLISECONDS, type TelemetryForwardContext } from '../sink'

const NOW = 1_700_000_000_000
const INSTALL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const APP_KEY = 'A-EU-0000000000'
const CONTEXT: TelemetryForwardContext = { receivedAt: NOW, countryCode: 'DE' }

interface CapturedRequest {
  url: string
  method: string | undefined
  headers: Record<string, string>
  body: AptabaseEvent[]
}

/** 下游替身：把请求留下来，回一个给定状态码（可附一行正文）。 */
function createFetcher(status = 200, body: string | null = null): { fetcher: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as AptabaseEvent[]) : [],
    })
    return new Response(body, { status })
  }) as typeof fetch
  return { fetcher, calls }
}

/** 一次转发并取回报文里的那一条事件——绝大多数断言只关心它。 */
async function forwardOne(event: TelemetryEvent, status = 200, context = CONTEXT) {
  const upstream = createFetcher(status)
  const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: upstream.fetcher })

  const outcome = await sink.forward([event], context)

  return { outcome, upstream, event: upstream.calls[0]?.body[0] }
}

type AppStarted = Extract<TelemetryEvent, { name: 'app_started' }>

function appStarted(overrides: Partial<AppStarted> = {}): TelemetryEvent {
  return {
    name: 'app_started',
    occurredAt: NOW - 1_000,
    installId: INSTALL_ID,
    version: '1.1.0-beta.14',
    os: 'win32',
    arch: 'x64',
    locale: 'en',
    runtime: 'desktop',
    ...overrides,
  }
}

describe('Aptabase 下游', () => {
  describe('去向', () => {
    it('打到批量端点，凭证在请求头里', async () => {
      const { upstream, event } = await forwardOne(appStarted())
      const [call] = upstream.calls

      expect(upstream.calls).toHaveLength(1)
      expect(call.url).toBe(APTABASE_EVENTS_URL)
      expect(call.method).toBe('POST')
      expect(call.headers['App-Key']).toBe(APP_KEY)
      expect(call.headers['Content-Type']).toBe('application/json')
      // 凭证既不进 URL（少一处「密钥会不会被记进某层访问日志」的疑问），也不进正文
      // （下游的接口签名就是 `[FromHeader(Name = "App-Key")]`，正文里放一份没有意义）。
      expect(call.url).not.toContain(APP_KEY)
      expect(JSON.stringify(call.body)).not.toContain(APP_KEY)
      expect(event).toBeDefined()
    })

    it('正文是裸数组，不套一层包装对象', async () => {
      const { upstream } = await forwardOne(appStarted())

      // 下游那条路收的就是一个事件数组：多套一层 `{ events: … }` 会被当成一条畸形事件整批 400。
      expect(Array.isArray(upstream.calls[0].body)).toBe(true)
    })

    it('一批里几条就是数组里几项，一次请求发完', async () => {
      const upstream = createFetcher()
      const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: upstream.fetcher })

      await sink.forward([appStarted(), appStarted({ occurredAt: NOW - 500 })], CONTEXT)

      expect(upstream.calls).toHaveLength(1)
      expect(upstream.calls[0].body).toHaveLength(2)
    })

    it('三样字段各就各位，其余同名落进属性表', async () => {
      const { event } = await forwardOne(appStarted())

      expect(event?.eventName).toBe('app_started')
      expect(event?.sessionId).toBe(INSTALL_ID)
      expect(event?.timestamp).toBe(new Date(NOW - 1_000).toISOString())
      // 没有对照表：契约里的字段名直接当属性名用，`arch` / `runtime` 也一样（它们在这里
      // **不再**是「用户属性」——那是 GA 的概念）。
      expect(event?.props).toMatchObject({
        version: '1.1.0-beta.14',
        os: 'win32',
        arch: 'x64',
        locale: 'en',
        runtime: 'desktop',
      })
      // 三样归位字段不重复出现。
      expect(event?.props).not.toHaveProperty('name')
      expect(event?.props).not.toHaveProperty('installId')
      expect(event?.props).not.toHaveProperty('occurredAt')
    })

    it('业务属性原样进来，不做任何改名', async () => {
      const modeChanged: TelemetryEvent = { ...appStarted(), name: 'route_mode_changed', mode: 'workflow' }

      const { event } = await forwardOne(modeChanged)

      expect(event?.props).toMatchObject({ mode: 'workflow' })
    })

    it('布尔属性保持布尔，不提前转成字符串', async () => {
      const exported: TelemetryEvent = { ...appStarted(), name: 'logs_exported', withContent: true }

      const { event } = await forwardOne(exported)

      // 契约用原生 JSON 布尔；下游要把它规范化成 `'true'` 是下游的事，我们不做那道加工。
      expect(event?.props.withContent).toBe(true)
    })

    it('保留属性只填三项，其余留空', async () => {
      const { event } = await forwardOne(appStarted())

      // `osVersion` / `engineName` / `deviceModel` / `appBuildNumber` 那几项有它们自己的取值
      // 规范（`engineName` 指的是浏览器引擎），猜错就污染下游的原生维度。
      expect(event?.systemProps).toEqual({
        sdkVersion: 'one-switch-worker',
        osName: 'win32',
        locale: 'en',
        appVersion: '1.1.0-beta.14',
      })
    })

    it('每条都带必填的 sdkVersion', async () => {
      const upstream = createFetcher()
      const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: upstream.fetcher })

      await sink.forward([appStarted(), appStarted({ occurredAt: NOW - 500 })], CONTEXT)

      // 空字符串会被下游整批 400，所以它不能是「想起来才填」的东西。
      for (const event of upstream.calls[0].body) expect(event.systemProps.sdkVersion).not.toBe('')
    })

    it('版本号超出下游的长度上限时不填保留属性，事件属性里那份仍在', async () => {
      const longVersion = '1.1.0-beta.14+build.abcdefghijklmnopqrstuvwxyz0123456789'

      const { event } = await forwardOne(appStarted({ version: longVersion }))

      // 契约给 `version` 的上限是 100，下游的 `appVersion` 只有 50。超长的版本号不是一个真实
      // 场景，但一个 400 会把**整批**打回去，所以这里宁可让这一条少一个保留属性。
      expect(event?.systemProps.appVersion).toBeUndefined()
      expect(event?.props.version).toBe(longVersion)
    })

    it('契约的批量上限不超过下游的硬上限', () => {
      // 这两个数字分属两边，谁也不知道对方改动过；这条用例是它们之间唯一的连线：
      // 契约哪天放宽到 26，这里先红，而不是等线上开始出现 400。
      expect(TELEMETRY_MAX_EVENTS_PER_BATCH).toBeLessThanOrEqual(APTABASE_MAX_EVENTS_PER_REQUEST)
    })
  })

  describe('「会话」这一栏', () => {
    it('放的是不轮换的安装标识', async () => {
      const { event } = await forwardOne(appStarted())

      // 契约里没有会话这个概念，把安装标识填进来是唯一的对应方式：去重会话数就等于去重安装数，
      // 跨天的活跃与留存可回答；代价是一个安装的所有事件会串成一条无限长的会话，不要拿它当
      // 会话时长看（见文件头）。
      expect(event?.sessionId).toBe(INSTALL_ID)
    })

    it('一批里每一条都带上', async () => {
      const upstream = createFetcher()
      const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: upstream.fetcher })

      await sink.forward([appStarted(), appStarted({ occurredAt: NOW - 500 })], CONTEXT)

      for (const event of upstream.calls[0].body) expect(event.sessionId).toBe(INSTALL_ID)
    })
  })

  describe('地理位置', () => {
    it('把 Cloudflare 的边缘判词当作事件属性带下去', async () => {
      const { event } = await forwardOne(appStarted())

      // 下游的报文里没有任何字段能收一个 IP 或一个国家（它的托管云在边缘按来源 IP 判定），
      // 所以地区改走事件属性——这样它和其余五个视图的口径也是同一个。
      expect(event?.props.country).toBe('DE')
    })

    it('拿不到国家时不带这个属性，而不是编一个', async () => {
      const { event } = await forwardOne(appStarted(), 200, { receivedAt: NOW, countryCode: null })

      expect(event?.props).not.toHaveProperty('country')
    })

    it('带下去的是两字母的国家，不是一个地址', async () => {
      const { event } = await forwardOne(appStarted())

      // 这条用例防的是「顺手把 IP 也带上」那种回归：客户端真实 IP 从头到尾不该离开 Worker。
      expect(event?.props.country).not.toContain('.')
      expect(JSON.stringify(event)).not.toContain('203.0.113.7')
    })
  })

  describe('时间戳', () => {
    it('窗口内用事件自己的发生时间', () => {
      expect(timestampOf(NOW - 1_000, NOW)).toBe(new Date(NOW - 1_000).toISOString())
    })

    it('超出回溯窗口时用接收时间顶上，事件照发', async () => {
      const { outcome, event } = await forwardOne(appStarted({ occurredAt: NOW - 25 * 60 * 60 * 1000 }))

      expect(outcome).toEqual({ ok: true })
      expect(event?.eventName).toBe('app_started')
      // 下游那条「一天前的不要」是它自己的规矩，而这里能选的只有「时间不准」与「这条不要」：
      // 补报允许损失时间精度，所以选前者。
      expect(event?.timestamp).toBe(new Date(NOW).toISOString())
    })

    it('窗口的边界就在下游的门槛之内', () => {
      // 下游拒收早于「一天前」的事件，而我们给接收时间留了余量；这条断言把那个关系钉住。
      expect(APTABASE_MAX_EVENT_AGE_MILLISECONDS).toBeLessThan(24 * 60 * 60 * 1000)
    })

    it('未来时间也用接收时间顶上', () => {
      expect(timestampOf(NOW + 60_000, NOW)).toBe(new Date(NOW).toISOString())
    })

    it('时间戳一定是个有值的 ISO 串', async () => {
      const { event } = await forwardOne(appStarted())

      // 下游的 `timestamp` 是必填：不给会被反序列化成「0001 年」那种远古时间，然后整条被丢。
      expect(event?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('结果', () => {
    it('下游连不上时返回 unreachable 而不是抛异常', async () => {
      const failing = (async () => {
        throw new Error('network down')
      }) as typeof fetch
      const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: failing })

      // sink 的契约是「永不抛」：抛出去会把 Worker 变成 500，而这一层能说的是「下游没接」。
      // `reason` 是给日志用的：非超时的那些都归 `error`（见 `TelemetryUnreachableReason`）。
      await expect(sink.forward([appStarted()], CONTEXT)).resolves.toEqual({
        ok: false,
        failure: 'unreachable',
        reason: 'error',
      })
    })

    it('下游 4xx 时带回状态码', async () => {
      const { outcome } = await forwardOne(appStarted(), 400)

      // `detail` 为 `null`：这个替身没有回正文，而「它没说话」就是事实。
      expect(outcome).toEqual({ ok: false, failure: 'rejected', status: 400, detail: null })
    })

    it('密钥不对时带回 404', async () => {
      // 下游在它自己那张表里找不到 App Key 就是 404——不是 401，也不是静默丢数据。
      // 所以「密钥的区域段与入口地址对不上」会在日志里立刻显形。
      const { outcome } = await forwardOne(appStarted(), 404)

      expect(outcome).toEqual({ ok: false, failure: 'rejected', status: 404, detail: null })
    })

    it('下游说了拒收的理由时原样带回', async () => {
      const upstream = createFetcher(400, 'Invalid App Key')
      const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: upstream.fetcher })

      // 状态码回答不了「为什么」：它把下游自己那句话一并交上去，由 Worker 记进日志。
      await expect(sink.forward([appStarted()], CONTEXT)).resolves.toEqual({
        ok: false,
        failure: 'rejected',
        status: 400,
        detail: 'Invalid App Key',
      })
    })

    it('下游的答复里有换行时只剩一行', async () => {
      const upstream = createFetcher(400, 'first line\nsecond line')
      const sink = createAptabaseSink({ appKey: APP_KEY, fetcher: upstream.fetcher })

      // 它最终会被拼进一条日志行，而日志是按行读的：一行变成两行就是在伪造记录。
      await expect(sink.forward([appStarted()], CONTEXT)).resolves.toEqual({
        ok: false,
        failure: 'rejected',
        status: 400,
        detail: 'first line second line',
      })
    })

    it('超时就放弃，不等下游', async () => {
      vi.useFakeTimers()
      try {
        const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })) as typeof fetch
        const sink = createAptabaseSink({ appKey: APP_KEY, fetcher })

        const pending = sink.forward([appStarted()], CONTEXT)
        await vi.advanceTimersByTimeAsync(FORWARD_TIMEOUT_MILLISECONDS + 1)

        // `reason=timeout`：这一次是我们自己那个定时器按下的，指向「下游慢」。
        await expect(pending).resolves.toEqual({ ok: false, failure: 'unreachable', reason: 'timeout' })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('名字是 aptabase——它是日志里唯一用来分辨下游的东西', () => {
    expect(createAptabaseSink({ appKey: APP_KEY, fetcher: createFetcher().fetcher }).name).toBe('aptabase')
  })
})
