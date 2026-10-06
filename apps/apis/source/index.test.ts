import { describe, expect, it, vi } from 'vitest'
import { TELEMETRY_MAX_REQUEST_BYTES, type TelemetryEvent } from '@common/telemetry'
import entry, { createTelemetryHandler, workerFetch, type TelemetryEnv } from './index'
import { ANALYTICS_ENGINE_BLOB_SLOTS, type AnalyticsEngineDataPoint } from './sinks/analytics-engine'

const NOW = 1_700_000_000_000
const INSTALL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ENDPOINT = 'https://api.osw.yinxulai.com/v1/track'

/**
 * 这些用例**刻意不认识下游的形状**。
 *
 * 它们验的是 Worker 自己的四条职责：路由、配置、校验，以及「下游答复 → 我方状态码」这一次映射。
 * 数据点里字段怎么摆是 sink 的事（见 `sinks/analytics-engine.test.ts`），这里只断言「写出去几个
 * 数据点」。理由不是洁癖：把下游的形状写进 Worker 的用例，等于「换一个 sink 就要改一批不相干的
 * 测试」，而那正是这套分层要消除的东西。
 *
 * 唯一越界的一处是下面「服务端事实」那一组，它要读 `country` 这一列——因为「读 `CF-IPCountry`、
 * 判它的形状、交给下游」正是这个文件负责的逻辑，而它唯一的观测面就是那个数据点。
 */
interface DatasetStub {
  /** 交给 `env.TELEMETRY` 的那一项。 */
  binding: NonNullable<TelemetryEnv['TELEMETRY']>
  /** 收下来的数据点，给断言用。 */
  points: AnalyticsEngineDataPoint[]
}

/**
 * 数据集替身。`throws` 用来造「这次调用没把数据点交出去」——这是这一版**唯一**的下游故障。
 *
 * 它是同步的：绑定就是同步的（见 `sinks/analytics-engine.ts`）。如果这里写成 async，那批用例就
 * 会在一个平台上并不存在的时序假设上通过。
 */
function createDataset(throws = false): DatasetStub {
  const points: AnalyticsEngineDataPoint[] = []
  return {
    binding: {
      writeDataPoint(point) {
        if (throws) throw new Error('dataset unavailable')
        points.push(point)
      },
    },
    points,
  }
}

/** 一个绑定上了、但什么都不记的 `env`。不需要看数据点的用例用它。 */
const ENV: TelemetryEnv = {
  TELEMETRY: {
    writeDataPoint() {
      // 故意什么都不做：这个替身只回答「handler 会不会因为缺绑定而回 500」。
    },
  },
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
   * 来源地址。**代码里已经没有它的读者了**（限流删掉了，绑定也不需要地址），还留着是为了钉住
   * 「它也就到此为止」：既不进日志，也不进数据集（见「下游失败时留一行日志」那条）。
   */
  address?: string | null
  /** Cloudflare 判出来的来源国家。不传就当作边缘没给（`countryOf` 返回 `null`）。 */
  country?: string | null
}

function post(options: PostOptions = {}): Request {
  const headers: Record<string, string> = {}
  if (options.contentType !== null) headers['content-type'] = options.contentType ?? 'application/json'
  if (options.address !== null) headers['cf-connecting-ip'] = options.address ?? '203.0.113.7'
  if (options.country !== null && options.country !== undefined) headers['CF-IPCountry'] = options.country
  const method = options.method ?? 'POST'
  // GET / HEAD 不允许带正文，而这里多数用例只关心状态码，所以只在这两个方法下省掉 body。
  const body = method === 'POST' ? options.body ?? JSON.stringify({ events: options.events ?? [appStarted()] }) : undefined
  return new Request(options.url ?? ENDPOINT, { method, headers, body })
}

/** 取数据点上某一列的值（顺序即 `ANALYTICS_ENGINE_BLOB_SLOTS`）。 */
function blobOf(point: AnalyticsEngineDataPoint, key: string): string | undefined {
  const index = ANALYTICS_ENGINE_BLOB_SLOTS.findIndex(slot => slot.key === key)
  return index === -1 ? undefined : (point.blobs ?? [])[index]
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
      const handler = createTelemetryHandler()

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
        const handler = createTelemetryHandler()

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
      const handler = createTelemetryHandler()

      const response = await handler(post({ method: 'GET' }), ENV, NOW)

      // 这个 405 同时也是部署后的探针：它只可能来自本 Worker，所以「路由注册上了没有」
      // 靠它就能回答，不必为此再单独开一个接口。
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    })

    it('非 JSON 的 Content-Type 拒绝', async () => {
      const handler = createTelemetryHandler()

      const response = await handler(post({ contentType: 'text/plain' }), ENV, NOW)

      expect(response.status).toBe(415)
    })

    it('带字符集的 JSON Content-Type 接受', async () => {
      const handler = createTelemetryHandler()

      const response = await handler(post({ contentType: 'application/json; charset=utf-8' }), ENV, NOW)

      expect(response.status).toBe(204)
    })
  })

  describe('配置', () => {
    /**
     * 这一组只剩「绑上了没有」一件判断。
     *
     * 上一版有三条，围着「密钥」转：完全没配、配成空字符串、以及一个形状古怪的值。绑定把后两条
     * 一起消掉了——`env.TELEMETRY` 是一个对象，空字符串这种「配了但没用」的中间态不存在，也没有
     * 格式可猜。所以这里只留「没绑上」，而它是 `wrangler.toml` 少写一段时**真实会发生**的那一种。
     */
    it.each([
      ['完全没有', {}],
      ['显式写成 undefined', { TELEMETRY: undefined }],
    ] as [string, TelemetryEnv][])('%s: 明确失败而不是静默丢数据', async (_name, env) => {
      const dataset = createDataset()
      const handler = createTelemetryHandler()

      const response = await handler(post(), env, NOW)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ ok: false, error: 'not_configured' })
      // 一个数据点都没写出去：这一档的后果是**数据丢了**，而丢了就该说丢在哪里。
      expect(dataset.points).toHaveLength(0)
    })
  })

  describe('请求体', () => {
    it('超过契约里的上限就拒绝', async () => {
      const handler = createTelemetryHandler()

      const response = await handler(post({ body: 'x'.repeat(65 * 1024) }), ENV, NOW)

      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ ok: false, error: 'payload_too_large' })
    })

    it('无法解析的 JSON 拒绝', async () => {
      const handler = createTelemetryHandler()

      const response = await handler(post({ body: '{ not json' }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_json' })
    })

    it('带问题的报文回显前几条原因', async () => {
      const handler = createTelemetryHandler()

      const response = await handler(post({ body: JSON.stringify({ events: [{ name: 'app_started' }] }) }), ENV, NOW)

      expect(response.status).toBe(400)
      const payload = (await response.json()) as { error: string; issues: string[] }
      expect(payload.error).toBe('invalid_payload')
      expect(payload.issues.length).toBeGreaterThan(0)
      expect(payload.issues.length).toBeLessThanOrEqual(5)
      expect(payload.issues[0]).toMatch(/^(events\.0\.|utils\.)/)
    })

    it('拒绝多余字段', async () => {
      const handler = createTelemetryHandler()

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
      const handler = createTelemetryHandler()
      const events = [appStarted(), appStarted(overrides)]

      const response = await handler(post({ events }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'mixed_batch' })
    })

    // 被拒绝的报文不该产生数据点：校验不过就在本地回头
    it('被拒绝的报文不写数据点', async () => {
      const dataset = createDataset()
      const handler = createTelemetryHandler()

      await handler(post({ events: [appStarted(), appStarted({ installId: crypto.randomUUID() })] }), { TELEMETRY: dataset.binding }, NOW)

      expect(dataset.points).toHaveLength(0)
    })

    // 版本、架构、宿主都会在同一次真实上报里合法地不同（升级、桌面端与命令行共用一个安装标识），
    // 所以它们**不在**同设备比对里。这条用例防的是「把比对条件越加越严」那种回归。
    it('同一批里版本或宿主不同不算混批', async () => {
      const handler = createTelemetryHandler()
      const events: TelemetryEvent[] = [
        appStarted(),
        { ...appStarted(), version: '1.1.0-beta.15', runtime: 'cli' },
      ]

      const response = await handler(post({ events }), ENV, NOW)

      expect(response.status).toBe(204)
    })

    it('节点类型是闭集：清单里的过，任意字符串不过', async () => {
      const handler = createTelemetryHandler()
      // 故意不写成 TelemetryEvent：这里要发的正是**不合契约**的那一份。
      const nodeRun = (node_kind: string) => ({ ...appStarted(), name: 'workflow_node_executed', node_kind })

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
      const handler = createTelemetryHandler()

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    })

    it('一批里几条事件就写几个数据点，不多不少', async () => {
      const dataset = createDataset()
      const handler = createTelemetryHandler()
      const events = [appStarted(), appStarted({ occurredAt: NOW - 500 })]

      const response = await handler(post({ events }), { TELEMETRY: dataset.binding }, NOW)

      // 上一版这里断言的是「一次 POST、正文是 JSON」——那时整批被打包成一个请求。这一版没有
      // 「一次请求」这种东西了：一条事件就是一个数据点，而**一批一个都不许少**（少写是静默的，
      // 见 `sinks/analytics-engine.ts` 的静默失败那节）。
      expect(response.status).toBe(204)
      expect(dataset.points).toHaveLength(2)
    })

    // 这一版唯一的下游故障。上一版这里有三条用例（连不上、被拒收、拒收但一言不发），因为那时
    // 下游是一个会说 HTTP 状态的第三方服务；现在绑定不回答任何东西，也就只剩下「交出去了没有」。
    it('写入没能交出去时算 502', async () => {
      const dataset = createDataset(true)
      const handler = createTelemetryHandler()

      const response = await handler(post(), { TELEMETRY: dataset.binding }, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'not_delivered' })
    })

    it('写入失败时不重试、不写第二遍', async () => {
      let calls = 0
      const handler = createTelemetryHandler()

      await handler(
        post({ events: [appStarted(), appStarted({ occurredAt: NOW - 500 })] }),
        {
          TELEMETRY: {
            writeDataPoint() {
              calls += 1
              throw new Error('dataset unavailable')
            },
          },
        },
        NOW,
      )

      // 第一条抛了就不再往下写：这是一次幂等追加，重试只会把同一批数据写第二遍，
      // 那是一个更难发现的口径问题（见 `sink.ts`）。
      expect(calls).toBe(1)
    })
  })

  /**
   * Worker 唯一比 sink 多知道的东西：HTTP 与 Cloudflare 填的头。
   *
   * 一组的观测面是数据点，因为那是这两项事实**唯一**的落点——`forward()` 的第二个参数就是它们。
   */
  describe('服务端事实', () => {
    it('CF-IPCountry 落成 country 列', async () => {
      const dataset = createDataset()
      const handler = createTelemetryHandler()

      await handler(post({ country: 'DE' }), { TELEMETRY: dataset.binding }, NOW)

      expect(blobOf(dataset.points[0], 'country')).toBe('DE')
    })

    it.each([
      ['没给这个头', undefined],
      ['给的是「不知道」', 'XX'],
      ['给的不是两字母', 'DEU'],
      ['给的是数字', '12'],
      ['给的是空', ''],
    ] as [string, string | undefined][])('边缘%s时不编一个国家', async (_name, country) => {
      const dataset = createDataset()
      const handler = createTelemetryHandler()

      await handler(post({ country: country ?? null }), { TELEMETRY: dataset.binding }, NOW)

      // 空串在存储侧的含义就是「没有这个值」。把「不知道」写成 `XX`（或写成一个猜出来的国家）
      // 会在地区视图里多出一个假国家，而它和真国家的区别没人看得出来。
      expect(blobOf(dataset.points[0], 'country')).toBe('')
    })

    it('小写的国家代码会被归一成大写', async () => {
      const dataset = createDataset()
      const handler = createTelemetryHandler()

      await handler(post({ country: 'de' }), { TELEMETRY: dataset.binding }, NOW)

      expect(blobOf(dataset.points[0], 'country')).toBe('DE')
    })

    it('来源地址既不进数据点，也不进日志', async () => {
      const dataset = createDataset()
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler()
        const address = '203.0.113.7'

        await handler(post({ address }), { TELEMETRY: dataset.binding }, NOW)

        // 这个头之前至少要被哈希一次才成为限流键，现在连一次哈希都没有了（见文件头「关于限流」）。
        expect(JSON.stringify(dataset.points)).not.toContain(address)
        expect(logs.lines).toEqual([])
      } finally {
        logs.restore()
      }
    })
  })

  describe('生产入口', () => {
    it('默认导出指向那个有名字的入口', () => {
      // 部署后真正被调用的是这一条路径，单独写一个函数的价值在于它可被搜到；
      // 这条用例防的是「改了入口名、忘了改默认导出」这种改完就静默失效的情形。
      expect(entry.fetch).toBe(workerFetch)
    })

    it('错误路径在进下游之前就被拦住', async () => {
      // 入口用的是真实的 `env`，所以这里只能选一个必然在下游之前就返回的用例。
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
        const handler = createTelemetryHandler()

        const response = await handler(post(), {}, NOW)

        expect(response.status).toBe(500)
        expect(logs.lines).toEqual(['[apis] status=500 error=not_configured missing=TELEMETRY'])
      } finally {
        logs.restore()
      }
    })

    it('未知路径：带上路径——旧地址与新写法只能靠它分开', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler()

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
        const handler = createTelemetryHandler()

        await handler(post({ method: 'GET' }), ENV, NOW)

        expect(logs.lines).toEqual(['[apis] status=405 error=method_not_allowed method=GET'])
      } finally {
        logs.restore()
      }
    })

    it('Content-Type 不对：带上原始值', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler()

        await handler(post({ contentType: 'text/plain' }), ENV, NOW)

        expect(logs.lines).toEqual(['[apis] status=415 error=unsupported_media_type content_type=text/plain'])
      } finally {
        logs.restore()
      }
    })

    it('报文太大：带上实际字节数与上限', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler()
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
        const handler = createTelemetryHandler()

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
        const handler = createTelemetryHandler()
        const events = [appStarted(), appStarted({ installId: crypto.randomUUID() })]

        await handler(post({ events }), ENV, NOW)

        expect(logs.lines).toEqual(['[apis] status=400 error=mixed_batch events=2'])
      } finally {
        logs.restore()
      }
    })

    it('下游没收到：一行，说清下游是谁、几条事件', async () => {
      const logs = captureLogs()
      try {
        const dataset = createDataset(true)
        const handler = createTelemetryHandler()

        await handler(post(), { TELEMETRY: dataset.binding }, NOW)

        // 上一版这一行是 `error=upstream_unreachable ... reason=error` 或
        // `error=upstream_rejected ... upstream_status=400 detail=…`。那些补充项现在一个都不存在：
        // 绑定不回话，所以除了「谁、几条」之外没有任何东西可说，而这两项正好是运维要的。
        expect(logs.lines).toEqual([
          '[apis] status=502 error=not_delivered sink=analytics-engine events=1',
        ])
      } finally {
        logs.restore()
      }
    })

    it('成功：一行都不记', async () => {
      const logs = captureLogs()
      try {
        const handler = createTelemetryHandler()

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
        // 绑定一直失败：最后那条**合法**的请求也要能落到一个留日志的出口上。
        const env: TelemetryEnv = { TELEMETRY: createDataset(true).binding }
        const handler = createTelemetryHandler()
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

        for (const request of requests) await handler(request, env, NOW)
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
