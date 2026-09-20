import { describe, expect, it, vi } from 'vitest'
import type { TelemetryEvent } from '@common/telemetry'
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

/** 下游替身。返回给定状态码，并把收到的请求留下来给断言用。 */
function createUpstream(status = 204): { fetcher: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response(null, { status })
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

    it('下游出事时留一行日志，但里面没有标识、没有地址、没有正文', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const upstream = createUpstream(400)
        const handler = createTelemetryHandler(upstream.fetcher)

        await handler(post({ address: '203.0.113.7' }), ENV, NOW)

        // `wrangler.toml` 把 `[observability]` 打开，等的就是这一行；而它同时承诺了日志里
        // 不问「谁在发」——这是那句承诺在测试里的落点。这一批报文是带着用户地址的，
        // 两处都不该有它：日志里没有，发给下游的正文里也没有（限流删掉之后，这条链路上
        // 没有任何一行代码读那个头，见文件头「关于限流」）。带上 sink 名是为了将来同时挂
        // 两个下游时这两行还能分开。
        expect(logged).toHaveBeenCalledTimes(1)
        const line = String(logged.mock.calls[0][0])
        expect(line).toContain('upstream rejected')
        expect(line).toContain('sink=aptabase')
        expect(line).toContain('status=400')
        expect(line).not.toContain(INSTALL_ID)
        expect(line).not.toContain('203.0.113.7')
        expect(JSON.stringify(upstream.calls[0].body)).not.toContain('203.0.113.7')
      } finally {
        logged.mockRestore()
      }
    })
  })
})
