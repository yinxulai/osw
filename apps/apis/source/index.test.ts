import { describe, expect, it, vi } from 'vitest'
import { TELEMETRY_MAX_REQUEST_BYTES, type TelemetryEvent } from '@common/telemetry'
import entry, { createTelemetryHandler, workerFetch, type TelemetryEnv } from './index'

const NOW = 1_700_000_000_000
const INSTALL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ENDPOINT = 'https://api.osw.yinxulai.com/v1/track'
const APP_KEY = 'A-EU-0000000000'
const ENV: TelemetryEnv = { APTABASE_APP_KEY: APP_KEY }

/**
 * 这些用例**刻意不认识下游**。
 *
 * 它们验的是 Worker 自己的四条职责：路由、配置、校验，以及「下游答复 → 我方状态码」
 * 这一次映射。报文里字段怎么摆是 sink 的事（见 `sinks/aptabase.test.ts`），这里只断言
 * 「发生了一次 POST、正文是 JSON」。理由不是洁癖：把下游的形状写进 Worker 的用例，等于
 * 「换一个 sink 就要改一批不相干的测试」，而那正是这套分层要消除的东西。
 */
interface CapturedRequest {
  url: string
  body: unknown
  method: string | undefined
  headers: Record<string, string>
}

/** 下游替身。返回给定状态码（可附一行正文），并把收到的请求留下来给断言用。 */
function createUpstream(status = 204, body: string | null = null): { fetcher: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response(body, { status })
  }) as typeof fetch
  return { fetcher, calls }
}

type EventOverrides = Partial<Pick<Extract<TelemetryEvent, { name: 'app_started' }>, 'installId' | 'os' | 'locale' | 'occurredAt'>>

function appStarted(overrides: EventOverrides = {}): TelemetryEvent {
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

interface PostOptions {
  events?: readonly TelemetryEvent[]
  body?: string
  contentType?: string | null
  method?: string
  url?: string
  /**
   * 来源地址。限流删掉之后**代码里已经没有它的读者了**，还留着是为了钉住「它也就到此为止」：
   * 既不进日志，也不进转发报文（见「下游出事时留一行日志」那条）。
   */
  address?: string | null
}

function post(options: PostOptions = {}): Request {
  const headers: Record<string, string> = {}
  if (options.contentType !== null) headers['content-type'] = options.contentType ?? 'application/json'
  if (options.address !== null) headers['cf-connecting-ip'] = options.address ?? '203.0.113.7'
  const method = options.method ?? 'POST'
  // GET / HEAD 不允许带正文，而这里多数用例只关心状态码，所以只在这两个方法下省掉 body。
  const body = method === 'POST' ? options.body ?? JSON.stringify({ events: options.events ?? [appStarted()] }) : undefined
  return new Request(options.url ?? ENDPOINT, { method, headers, body })
}

/**
 * 把日志接下来。
 *
 * 两条出口都接：4xx 走 `warn`、5xx 走 `error`（见 `source/log.ts`），而用例关心的是
 * 「有没有这一行、长什么样」，不是它落在哪条出口上。
 */
function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const collect = (...args: unknown[]): number => lines.push(args.map(arg => String(arg)).join(' '))
  const warn = vi.spyOn(console, 'warn').mockImplementation(collect)
  const error = vi.spyOn(console, 'error').mockImplementation(collect)
  return {
    lines,
    restore: () => {
      warn.mockRestore()
      error.mockRestore()
    },
  }
}

describe('上报端点', () => {
  describe('路由与请求头', () => {
    it('根路径也是 404——域名上不留「不知道为什么有回应」的地址', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(
        post({ url: 'https://api.osw.yinxulai.com/', method: 'GET', contentType: null }),
        ENV,
        NOW,
      )

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
    })

    // 端点只有一条，所以「近亲路径」也必须被拒：多一个斜杠、多一段、换一个名字都算别的地址。
    // `/v1/events` 是这条路径的**旧名字**，单独立一条回归用例：改名之后它必须一直是 404，
    // 否则会把「老客户端还在打旧地址」误报成「请求成功了」。
    it.each(['/v1/events', '/v1/track/', '/v1/track/extra'])(
      '%s 不是端点，与其他未知路径一样 404',
      async path => {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        const response = await handler(
          post({ url: `https://api.osw.yinxulai.com${path}`, method: 'GET', contentType: null }),
          ENV,
          NOW,
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
      },
    )

    it('GET /v1/track 只允许 POST', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ method: 'GET' }), ENV, NOW)

      // 这个 405 同时也是部署后的探针：它只可能来自本 Worker，所以「路由注册上了没有」
      // 靠它就能回答，不必为此再单独开一个接口。
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    })

    it('非 JSON 的 Content-Type 拒绝', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ contentType: 'text/plain' }), ENV, NOW)

      expect(response.status).toBe(415)
    })

    it('带字符集的 JSON Content-Type 接受', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post({ contentType: 'application/json; charset=utf-8' }), ENV, NOW)

      expect(response.status).toBe(204)
    })
  })

  describe('配置', () => {
    // 密钥的名字跟着下游走，所以这里也顺带钉住「配的是哪家的东西」：换后端时这一组会跟着变，
    // 那正是应该发生的（见 `TelemetryEnv`）。
    it.each([
      ['完全没有', {}],
      ['是空字符串', { APTABASE_APP_KEY: '' }],
    ] as [string, TelemetryEnv][])('%s: 明确失败而不是静默丢数据', async (_name, env) => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post(), env, NOW)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ ok: false, error: 'not_configured' })
      expect(upstream.calls).toHaveLength(0)
    })

    // 只判断「有没有值」，不去猜格式：前缀、区域段、长度都不看。猜错的代价是「部署时看着没问题，
    // 上线后一条都收不到」，所以一个形状古怪的密钥必须能通过这一层，由下游去回答它。
    it('不猜密钥格式：形状古怪的值照样发出去', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post(), { APTABASE_APP_KEY: 'not-a-key' }, NOW)

      expect(response.status).toBe(204)
      expect(upstream.calls).toHaveLength(1)
    })
  })

  describe('请求体', () => {
    it('超过契约里的上限就拒绝', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ body: 'x'.repeat(65 * 1024) }), ENV, NOW)

      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ ok: false, error: 'payload_too_large' })
    })

    it('无法解析的 JSON 拒绝', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ body: '{ not json' }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_json' })
    })

    it('带问题的报文回显前几条原因', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ body: JSON.stringify({ events: [{ name: 'app_started' }] }) }), ENV, NOW)

      expect(response.status).toBe(400)
      const payload = (await response.json()) as { error: string; issues: string[] }
      expect(payload.error).toBe('invalid_payload')
      expect(payload.issues.length).toBeGreaterThan(0)
      expect(payload.issues.length).toBeLessThanOrEqual(5)
      expect(payload.issues[0]).toMatch(/^(events\.0\.|utils\.)/)
    })

    it('拒绝多余字段', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(
        post({ body: JSON.stringify({ events: [appStarted()], extra: 1 }) }),
        ENV,
        NOW,
      )

      expect(response.status).toBe(400)
    })

    it.each([
      ['安装标识不同', { installId: '9f2504e0-4f89-41d3-9a0c-0305e82c3302' }],
      ['平台不同', { os: 'darwin' }],
      ['界面语言不同', { locale: 'zh-CN' }],
    ] as [string, EventOverrides][])('一批里%s时拒收', async (_name, overrides) => {
      const handler = createTelemetryHandler(createUpstream().fetcher)
      const events = [appStarted(), appStarted(overrides)]

      const response = await handler(post({ events }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'mixed_batch' })
    })

    // 被拒绝的报文不该占用下游的连接：校验不过就在本地回头
    it('被拒绝的报文不计入下游', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post({ events: [appStarted(), appStarted({ installId: crypto.randomUUID() })] }), ENV, NOW)

      expect(upstream.calls).toHaveLength(0)
    })

    // 版本、架构、宿主都会在同一次真实上报里合法地不同（升级、桌面端与命令行共用一个安装标识），
    // 所以它们**不在**同设备比对里。这条用例防的是「把比对条件越加越严」那种回归。
    it('同一批里版本或宿主不同不算混批', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)
      const events: TelemetryEvent[] = [
        appStarted(),
        { ...appStarted(), version: '1.1.0-beta.15', runtime: 'cli' },
      ]

      const response = await handler(post({ events }), ENV, NOW)

      expect(response.status).toBe(204)
    })

    it('节点类型是闭集：清单里的过，任意字符串不过', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)
      // 故意不写成 TelemetryEvent：这里要发的正是**不合契约**的那一份。
      const nodeRun = (nodeKind: string) => ({ ...appStarted(), name: 'workflow_node_run', nodeKind })

      const accepted = await handler(post({ body: JSON.stringify({ events: [nodeRun('condition')] }) }), ENV, NOW)
      // 24 个字符的 URL 塞得进旧的名字长度上限，这条用例验的就是那条缝已经封死。
      const rejected = await handler(
        post({ body: JSON.stringify({ events: [nodeRun('https://example.com/?q=1')] }) }),
        ENV,
        NOW,
      )

      expect(accepted.status).toBe(204)
      expect(rejected.status).toBe(400)
    })
  })

  describe('交给下游', () => {
    it('成功时返回 204 且不带正文', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    })

    it('一批只发一次 POST，正文是 JSON', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)
      const events = [appStarted(), appStarted({ occurredAt: NOW - 500 })]

      await handler(post({ events }), ENV, NOW)

      // 只断言「一次请求、POST、JSON 正文」：拆不拆包、发到哪个地址、字段怎么摆全在下游那一层，
      // 而下游的用例在 `sinks/aptabase.test.ts`。
      expect(upstream.calls).toHaveLength(1)
      expect(upstream.calls[0].method).toBe('POST')
      expect(upstream.calls[0].body).toBeTypeOf('object')
    })

    it('密钥只出现在请求头里，不进 URL', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post(), ENV, NOW)

      // 凭证放哪里是下游自己的规矩（这一版是请求头）；无论放哪，URL 里都不该有它——
      // 那是最容易被记进某层访问日志的地方。
      expect(upstream.calls[0].url).not.toContain(APP_KEY)
      expect(upstream.calls[0].headers['App-Key']).toBe(APP_KEY)
    })

    it('下游连不上算 502', async () => {
      const failing = (async () => {
        throw new Error('network down')
      }) as typeof fetch
      const handler = createTelemetryHandler(failing)

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'upstream_unreachable' })
    })

    it('下游拒收时原样暴露它的状态码', async () => {
      const handler = createTelemetryHandler(createUpstream(400).fetcher)

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'upstream_rejected', status: 400 })
    })
  })

  describe('生产入口', () => {
    it('默认导出指向那个有名字的入口', () => {
      // 部署后真正被调用的是这一条路径，单独写一个函数的价值在于它可被搜到；
      // 这条用例防的是「改了入口名、忘了改默认导出」这种改完就静默失效的情形。
      expect(entry.fetch).toBe(workerFetch)
    })

    it('错误路径在进下游之前就被拦住', async () => {
      // 入口用的是运行时 `fetch`，所以这里只能选一个必然在打网络之前就返回的用例。
      const response = await workerFetch(
        post({ url: 'https://api.osw.yinxulai.com/', method: 'GET', contentType: null }),
        ENV,
      )

      expect(response.status).toBe(404)
    })
  })

  /**
   * 这一组防的是那次事故：唯一那个 500 曾经**没有日志**，于是现场只剩下客户端那句
   * `telemetry endpoint responded with 500`——状态码有了，原因要人去翻代码才知道。
   *
   * 断言的是**整行**而不是「包含某个词」：行就是一个格式，格式漂了就该红；而「包含」
   * 这种断言在字段改名、顺序变化时全都会通过。
   */
  describe('日志', () => {
    it('缺配置：一行，并且点名缺的是哪一项', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        const response = await handler(post(), {}, NOW)

        expect(response.status).toBe(500)
        expect(logs.lines).toEqual(['[apis] status=500 error=not_configured missing=APTABASE_APP_KEY'])
      } finally {
        logs.restore()
      }
    })

    it('未知路径：带上路径——旧地址与新写法只能靠它分开', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        await handler(
          post({ url: 'https://api.osw.yinxulai.com/v1/events', method: 'GET', contentType: null }),
          ENV,
          NOW,
        )

        expect(logs.lines).toEqual(['[apis] status=404 error=not_found path=/v1/events'])
      } finally {
        logs.restore()
      }
    })

    it('方法不对：带上方法', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        await handler(post({ method: 'GET' }), ENV, NOW)

        expect(logs.lines).toEqual(['[apis] status=405 error=method_not_allowed method=GET'])
      } finally {
        logs.restore()
      }
    })

    it('Content-Type 不对：带上原始值', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        await handler(post({ contentType: 'text/plain' }), ENV, NOW)

        expect(logs.lines).toEqual(['[apis] status=415 error=unsupported_media_type content_type=text/plain'])
      } finally {
        logs.restore()
      }
    })

    it('报文太大：带上实际字节数与上限', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)
        const body = 'x'.repeat(65 * 1024)

        await handler(post({ body }), ENV, NOW)

        expect(logs.lines).toEqual([
          `[apis] status=413 error=payload_too_large bytes=${body.length} limit=${TELEMETRY_MAX_REQUEST_BYTES}`,
        ])
      } finally {
        logs.restore()
      }
    })

    it('报文不合 schema：只留第一条原因，五条会把一行撑成五行', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        await handler(post({ body: JSON.stringify({ events: [{ name: 'app_started' }] }) }), ENV, NOW)

        expect(logs.lines).toHaveLength(1)
        expect(logs.lines[0]).toContain('status=400 error=invalid_payload issue=events.0.')
      } finally {
        logs.restore()
      }
    })

    it('混批：只说几条混了，不说哪两台设备', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)
        const events = [appStarted(), appStarted({ installId: crypto.randomUUID() })]

        await handler(post({ events }), ENV, NOW)

        expect(logs.lines).toEqual(['[apis] status=400 error=mixed_batch events=2'])
      } finally {
        logs.restore()
      }
    })

    it('下游连不上：说清楚是哪一种没有回答', async () => {
      const logs = captureLogs()
      try {
        const failing = (async () => {
          throw new Error('network down')
        }) as typeof fetch
        const handler = createTelemetryHandler(failing)

        await handler(post(), ENV, NOW)

        // `reason=error` 而不是 `timeout`：这两个词指向完全不同的排查方向（见
        // `TelemetryUnreachableReason`），而它们各自只有一个单词的信息量。
        expect(logs.lines).toEqual([
          '[apis] status=502 error=upstream_unreachable sink=aptabase reason=error events=1',
        ])
      } finally {
        logs.restore()
      }
    })

    it('下游拒收：把它的答复一起记下来', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream(400, 'Invalid App Key').fetcher)

        await handler(post(), ENV, NOW)

        // 「下游回了 400」与「下游回了 400，说 App Key 不认识」之间，差的正好是排查要的那一步。
        expect(logs.lines).toEqual([
          '[apis] status=502 error=upstream_rejected sink=aptabase upstream_status=400 events=1 detail=Invalid App Key',
        ])
      } finally {
        logs.restore()
      }
    })

    it('下游拒收但一言不发：那一项就不输出', async () => {
      const logs = captureLogs()
      try {
        const upstream = createUpstream(400)
        const handler = createTelemetryHandler(upstream.fetcher)

        await handler(post(), ENV, NOW)

        expect(logs.lines).toEqual([
          '[apis] status=502 error=upstream_rejected sink=aptabase upstream_status=400 events=1',
        ])
        // 顺带钉住那条老承诺：地址既不在日志里，也不在发给下游的正文里（限流删掉之后，
        // 这条链路上没有任何一行代码读那个头，见文件头「关于限流」）。
        expect(JSON.stringify(upstream.calls[0].body)).not.toContain('203.0.113.7')
      } finally {
        logs.restore()
      }
    })

    it('成功：一行都不记', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        const response = await handler(post(), ENV, NOW)

        expect(response.status).toBe(204)
        // 成功行会按「安装数 × 频率」增长，而它回答不了任何问题（见 `source/log.ts`）。
        expect(logs.lines).toEqual([])
      } finally {
        logs.restore()
      }
    })

    it('走遍每一个失败出口：一行一条，且没有任何一条带上标识或地址', async () => {
      const logs = captureLogs()
      try {
        const address = '203.0.113.7'
        const handler = createTelemetryHandler(createUpstream(400, 'Invalid App Key').fetcher)
        const requests: Request[] = [
          post({ url: 'https://api.osw.yinxulai.com/', method: 'GET', contentType: null, address }),
          post({ method: 'GET', address }),
          post({ contentType: 'text/plain', address }),
          post({ body: 'x'.repeat(65 * 1024), address }),
          post({ body: '{ not json', address }),
          post({ body: JSON.stringify({ events: [{ name: 'app_started' }] }), address }),
          post({ events: [appStarted(), appStarted({ installId: crypto.randomUUID() })], address }),
          post({ address }),
        ]

        for (const request of requests) await handler(request, ENV, NOW)
        // 配置那一档单独走：它的 `env` 与别人不同。
        await handler(post({ address }), {}, NOW)

        // 「一行是一条」是这套日志唯一真正的格式约定，也是下面那两条断言的先决条件：
        // 标识或地址一旦混进来，它只会出现在这九行里，不会藏在某一行中间。
        expect(logs.lines).toHaveLength(requests.length + 1)
        for (const line of logs.lines) {
          expect(line).toContain('[apis] status=')
          expect(line).not.toContain(INSTALL_ID)
          expect(line).not.toContain(address)
        }
      } finally {
        logs.restore()
      }
    })
  })
})
