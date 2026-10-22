import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagementGateway, type GatewayOutcome, type ManagementGatewayOptions } from './gateway'

/**
 * 网关的**顺序**与**配置**。
 *
 * 这里替身掉唯一一个真会连数据库的协作者（路由），其余全是真的：真的 `http.Server`、
 * 真的文件系统、真的凭证比较。理由是这张表测的就是「谁先接手」——把静态托管也替身掉，
 * 验到的只是「我按我写的顺序调了替身」。
 *
 * 各段自己的判据在别处：凭证与 CORS 在 `gateway/access.test.ts`，
 * 静态语义在 `gateway/console-host.test.ts`，开发路径匹配在 `gateway/development.test.ts`。
 */

const mocks = vi.hoisted(() => ({ handleApiRequest: vi.fn() }))

vi.mock('./router', () => ({ handleApiRequest: mocks.handleApiRequest }))

const TOKEN = 'test-management-token'

const servers: http.Server[] = []
let temporaryDirectory: string | null = null

afterEach(async () => {
  await Promise.all(servers.splice(0).map(next => new Promise<void>(resolve => next.close(() => resolve()))))
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = null
  vi.restoreAllMocks()
  mocks.handleApiRequest.mockReset()
  mocks.handleApiRequest.mockImplementation(async (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.statusCode = 200
    res.end('api')
  })
})

interface ServeOptions extends ManagementGatewayOptions {
  method?: string
  path: string
  origin?: string
  /**
   * 请求头里带的凭证。`undefined` 表示「不带」，`null` 等同于不带（只为让「没凭证」
   * 在调用处读起来明确）。
   *
   * 与 `token`（服务端配的那份）分开：这两件事经常要单独验证，合成一个字段就无法
   * 写出「宿主配了凭证、但这条请求没带」。
   */
  requestToken?: string | null
  host?: string
}

interface ServedResponse {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
  outcome: GatewayOutcome
}

/**
 * 起一个真服务，把这条请求交给网关，并把网关报的「落到了哪一步」一起带回来。
 *
 * 返回值是网关自己报的，不是从状态码反推的：多个分支会回同一个状态码，靠状态码猜
 * 会让「落到了路由」与「在门前被挡」这两件完全不同的事分不出来。
 */
async function serve(options: ServeOptions): Promise<ServedResponse> {
  const gateway = createManagementGateway({
    webRoot: options.webRoot,
    token: options.token === undefined ? TOKEN : options.token,
    environment: options.environment,
  })
  let report: (outcome: GatewayOutcome) => void = () => undefined
  const settled = new Promise<GatewayOutcome>(resolve => { report = resolve })

  const server = http.createServer(async (req, res) => {
    report(await gateway.handle(req, res))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const headers: Record<string, string> = {}
  if (options.origin !== undefined) headers.origin = options.origin
  if (options.requestToken !== undefined && options.requestToken !== null) headers['x-osw-token'] = options.requestToken
  if (options.host !== undefined) headers.host = options.host

  const response = await new Promise<Omit<ServedResponse, 'outcome'>>((resolve, reject) => {
    // 用 `http.request` 而不是 `fetch`：`Host` 是 Fetch 规范的 forbidden header，
    // undici 会静默丢掉它并按 URL 自己生成。
    const request = http.request(
      { hostname: '127.0.0.1', port, path: options.path, method: options.method ?? 'POST', headers },
      incoming => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => resolve({
          status: incoming.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: incoming.headers,
        }))
      },
    )
    request.on('error', reject)
    request.end()
  })

  return { ...response, outcome: await settled }
}

/** 一份最小的控制台产物目录：够验证「静态托管排在所有门之前」即可。 */
function createWebRoot(): string {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-gateway-'))
  fs.writeFileSync(path.join(temporaryDirectory, 'index.html'), '<!doctype html><html><head><title>console</title></head><body></body></html>')
  return temporaryDirectory
}

describe('the console comes first', () => {
  it('answers a front-end route and never reaches the api', async () => {
    // 页面必须能从自己的端口加载，所以静态托管排在凭证之前——否则命令行 `--web` 形态
    // 连登录页都打不开，页面自己也没法带着凭证去请求 API。
    const response = await serve({ path: '/runtime-settings', method: 'GET', webRoot: createWebRoot() })

    expect(response.status).toBe(200)
    expect(response.body).toContain('console')
    expect(response.outcome).toBe('console')
    // SPA 回退要拿到未被改写过的请求，所以它必须排在所有门之前。
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('leaves /api paths to the api layer even when a web root is configured', async () => {
    const response = await serve({ path: '/api/settings/get', webRoot: createWebRoot(), environment: 'production', requestToken: TOKEN })

    expect(response.body).toBe('api')
    expect(response.outcome).toBe('api')
  })

  it('has no console at all when no web root is given', async () => {
    // 桌面形态自己 `loadFile`，不经过这里。
    const response = await serve({ path: '/api/settings/get', environment: 'production', requestToken: TOKEN })

    expect(response.body).toBe('api')
    expect(response.outcome).toBe('api')
  })

  it('reports no console root when hosting is off', () => {
    // 启动日志靠它决定要不要打一行「正在托管控制台」。
    expect(createManagementGateway({}).consoleRoot).toBeNull()
  })

  it('reports the resolved console root when hosting is on', () => {
    expect(createManagementGateway({ webRoot: createWebRoot() }).consoleRoot).toBe(temporaryDirectory)
  })
})

describe('the access gate', () => {
  it('answers a preflight before asking for a credential', async () => {
    // 预检是浏览器自己发的，它既不可能带自定义头，也不该被要求带。
    const response = await serve({ path: '/api/settings/get', method: 'OPTIONS', origin: 'http://localhost:5173' })

    expect(response.status).toBe(204)
    expect(response.outcome).toBe('rejected')
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('turns down a browser request that carries no credential', async () => {
    // 最核心的一条：本机任意网页都能发这个请求，没有凭证就必须被挡住，
    // 否则 issue #76 里那条「沙箱 iframe 读走明文密钥」的路依然通着。
    const response = await serve({ path: '/api/settings/get', origin: 'http://localhost:5173' })

    expect(response.status).toBe(401)
    expect(response.outcome).toBe('rejected')
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('lets a browser request through when the credential matches', async () => {
    const response = await serve({ path: '/api/settings/get', origin: 'http://localhost:5173', requestToken: TOKEN })

    expect(response.outcome).toBe('api')
    expect(mocks.handleApiRequest).toHaveBeenCalledOnce()
  })

  it('turns down a local process that carries no credential', async () => {
    // 这条曾经是「免凭证」的通行证。`Origin` / `Sec-Fetch-*` 是调用方自己写的头，
    // 任何本机进程不发它们就能调 `/api/provider/export` 拿走明文密钥——凭什么它就该
    // 比别人更自由。凭证是唯一的门，对谁都一样。
    const response = await serve({ path: '/api/settings/get' })

    expect(response.status).toBe(401)
    expect(response.outcome).toBe('rejected')
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('lets any caller through once it presents the credential', async () => {
    const response = await serve({ path: '/api/settings/get', requestToken: TOKEN })

    expect(response.outcome).toBe('api')
    expect(mocks.handleApiRequest).toHaveBeenCalledOnce()
  })

  it('still turns down a browser request when the host handed over no credential', async () => {
    // 凭证缺失是配置异常，不是「不设防」：这时必须 fail-closed，否则一个漏传配置的
    // 环境会静默变成一个对任何本机网页可写的环境。
    const response = await serve({ path: '/api/settings/get', origin: 'http://localhost:5173', token: null, requestToken: TOKEN })

    expect(response.status).toBe(401)
    expect(response.outcome).toBe('rejected')
  })

  it('also turns down a local process when the host handed over no credential', async () => {
    // 同上，但不带任何浏览器痕迹：凭证缺失时没有「谁比较可信」这回事，全挡。
    const response = await serve({ path: '/api/settings/get', token: null, requestToken: TOKEN })

    expect(response.status).toBe(401)
    expect(response.outcome).toBe('rejected')
  })

  it('never leaks the credential to a request the gate turned down', async () => {
    // 仓库里最贵的那类错误：被挡住的那条 401 响应体里带着凭证，等于门自己开了个洞。
    const response = await serve({ path: '/api/settings/get', origin: 'http://localhost:5173' })

    expect(response.body).not.toContain(TOKEN)
  })
})

/*
 * 开发形态的旁路。
 *
 * 它只剩一条：造演示数据。边界是**只在开发形态**、**只在网关这一层判**。散在各处
 * 判断过一轮的后果是明确的——路由里忘判一次，生产实例就能被一键灌满演示数据。
 *
 * 曾经还有一条「读出本次启动的凭证」。凭证改成无条件校验之后它被删了：一个把凭证
 * 发出去的接口，在全局校验下只能是绕过校验的后门（见 `gateway/development.ts`）。
 */
describe('development-only paths', () => {
  it('hides the seed path outside development', async () => {
    const response = await serve({ path: '/api/development/seed', environment: 'production', requestToken: TOKEN })

    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(response.outcome).toBe('development-path')
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('lets the seed path through in development', async () => {
    const response = await serve({ path: '/api/development/seed', environment: 'development', requestToken: TOKEN })

    expect(response.outcome).toBe('api')
    expect(mocks.handleApiRequest).toHaveBeenCalled()
  })

  it('matches the whole path, so a lookalike is left to the router', async () => {
    // `/api/development/seed/` 是另一条路径（它不存在，路由会给 404）。门禁顺手盖住它，
    // 只会让一个本该由路由回答的问题变成第二处判断。
    const response = await serve({ path: '/api/development/seed/', environment: 'production', requestToken: TOKEN })

    expect(response.outcome).toBe('api')
  })

  it('defaults to production when no environment is given', async () => {
    // 缺省必须是严的那个：忘了传环境不该顺手打开开发路径。
    const response = await serve({ path: '/api/development/seed', requestToken: TOKEN })

    expect(response.status).toBe(404)
    expect(response.outcome).toBe('development-path')
  })
})
