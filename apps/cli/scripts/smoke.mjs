/**
 * CLI 冒烟测试：拿**构建产物**跑一遍真进程，验证那些静态检查看不见的东西。
 *
 * 为什么必须存在这个脚本：CLI 的失败模式大多只在运行时暴露——分包加载顺序、
 * `import()` 被 Vite 包成 preload helper、监听地址归一化、单实例锁、信号与握手。
 * 这些在 typecheck / lint / 单测里全都是绿的，构建产物却可能是坏的（历史上真出过一次：
 * 动态 import 的 helper 在 Node 里碰到了 `document`，而所有静态检查都通过）。
 *
 * 只碰临时数据目录与随机空闲端口，不会动到本机正在跑的 OSW。
 * 前置条件：先构建（`pnpm build:cli`）。
 *
 * 用法：pnpm smoke:cli
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'

const cliDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = path.join(cliDirectory, 'output/index.js')
const webIndexPath = path.join(cliDirectory, 'output/web/index.html')

/**
 * 一个「肯定不存在」的 pid，用来伪造崩溃残留。
 *
 * 取一个远超各平台 pid 上限的值，`kill(pid, 0)` 必然报错而不是「恰好有个进程是这个号」。
 * 换成「起一个马上退出的子进程再拿它的 pid」会更好看，但 Windows 上 pid 回收得快，
 * 反而可能撞上活着的进程。
 */
const DEAD_PID = 2_147_483_646

const TOTAL_STEPS = 9
const BANNER_MARKER = 'Ctrl+C'

/** 起一个实例并等它打完横幅的超时。首次启动要建库、跑迁移，给宽一点。 */
const BOOT_TIMEOUT_MILLISECONDS = 60_000

const instances = new Set()

function launch(args) {
  const child = spawn(process.execPath, [entryPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const instance = { child, args, stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    instance.stdout += chunk
  })
  child.stderr.on('data', chunk => {
    instance.stderr += chunk
  })
  instance.exited = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  instances.add(instance)
  void instance.exited.then(() => instances.delete(instance))
  return instance
}

/** 跑完一个会自己退出的命令。 */
async function runOnce(args, timeoutMilliseconds = 30_000) {
  const instance = launch(args)
  const guard = setTimeout(() => instance.child.kill(), timeoutMilliseconds)
  const { code, signal } = await instance.exited
  clearTimeout(guard)
  // 超时兜底杀掉之后 `code` 是 null、`signal` 有值——这正是调用方该看到的失败形态。
  return { code, signal, stdout: instance.stdout, stderr: instance.stderr, args }
}

function assertExitCode(result, expected) {
  assert.equal(
    result.code,
    expected,
    `osw ${result.args.join(' ')} → exit ${result.code} (signal ${result.signal})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
  )
}

function describeInstance(instance) {
  return `osw ${instance.args.join(' ')}\n--- stdout ---\n${instance.stdout}\n--- stderr ---\n${instance.stderr}`
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitUntil(predicate, timeoutMilliseconds, describe) {
  const deadline = Date.now() + timeoutMilliseconds
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMilliseconds}ms: ${describe()}`)
    await delay(100)
  }
}

/** 等横幅出现。同时盯着「进程已经死了」——否则一个起不来的实例会挂满整个超时。 */
async function waitForBanner(instance) {
  await waitUntil(
    () => {
      if (instance.child.exitCode !== null) throw new Error(`the instance exited before printing its banner\n${describeInstance(instance)}`)
      return instance.stdout.includes(BANNER_MARKER)
    },
    BOOT_TIMEOUT_MILLISECONDS,
    () => `no startup banner\n${describeInstance(instance)}`,
  )
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** 端口是否有人接。用来证明 `stop` 真的把端口还回来了，而不仅仅是「进程没了」。 */
function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const settle = result => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(500)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

/**
 * 管理 API 全部是 POST，`GET` 一律 405（见 core 的 `management/gateway/access.ts`）。
 *
 * 凭证**没有例外**：任何 `/api/*` 都得带上它，带上没带都一样。它由服务写在数据目录里的
 * `management.token`（`0600`），所以这里用 `readManagementToken()` 去拿。
 *
 * `origin` 只是个可选项：带上它就是「浏览器发来的」，用来验证 CORS 预检与页面注入那条链；
 * 它不再参与「要不要凭证」的判断。
 */
async function postJson(port, apiPath, options = {}) {
  const token = options.token ?? null
  const origin = options.origin ?? null
  const headers = { 'content-type': 'application/json' }
  if (token) headers['x-osw-token'] = token
  if (origin) headers.origin = origin
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

/**
 * 读本次启动的凭证。
 *
 * 文件名与权限见 core 的 `management/token-file.ts`。它在这里就是「另一个进程」能拿到的
 * 全部东西——`osw stop` / `osw status` 走的是同一条路，所以这一步顺便证明了那条契约。
 */
function readManagementToken(dataDir) {
  const filePath = path.join(dataDir, 'management.token')
  assert.ok(fs.existsSync(filePath), 'the management token file must exist while the server is listening')
  return fs.readFileSync(filePath, 'utf8').trim()
}

/**
 * 发一条 `Host` 由调用方指定的 GET。
 *
 * 不能用 `fetch`：`Host` 是 Fetch 规范的 forbidden header，undici 会静默丢掉它、按 URL
 * 自己生成 `127.0.0.1:port`——那样测到的永远是「回环 Host 拿得到凭证」，断言等于没写。
 */
function getWithHost(port, pathname, hostHeader) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method: 'GET', headers: { host: hostHeader } },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

async function readStatusJson(dataDir) {
  const result = await runOnce(['status', '--json', '--data-dir', dataDir])
  assertExitCode(result, 0)
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`status --json did not print JSON\n${result.stdout}\n${result.stderr}`)
  }
}

function runtimeFilePathOf(dataDir) {
  return path.join(dataDir, 'runtime.json')
}

function readRuntimeFile(dataDir) {
  return JSON.parse(fs.readFileSync(runtimeFilePathOf(dataDir), 'utf8'))
}

async function cleanup() {
  for (const instance of instances) {
    if (instance.child.exitCode === null) instance.child.kill()
  }
  if (instances.size > 0) {
    await Promise.race([Promise.all([...instances].map(instance => instance.exited)), delay(5_000)])
  }
}

async function main() {
  log.title('OSW CLI smoke test')

  if (!fs.existsSync(entryPath)) {
    log.error(`build output not found at ${entryPath}; run "pnpm build:cli" first`)
    process.exit(1)
  }
  // 托管控制台是默认行为，产物缺失时 `start` 会直接拒绝启动（这是刻意的），
  // 这里先给出更早、更清楚的报错。
  if (!fs.existsSync(webIndexPath)) {
    log.error(`console artifacts not found at ${webIndexPath}; run "pnpm build:cli" first`)
    process.exit(1)
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-smoke-'))
  const proxyPort = await findFreePort()
  const managementPort = await findFreePort()
  const spareProxyPort = await findFreePort()
  const spareManagementPort = await findFreePort()
  const baseArgs = ['--data-dir', dataDir, '--proxy-port', String(proxyPort), '--management-port', String(managementPort)]

  log.step(1, TOTAL_STEPS, 'start (console served)')
  const main1 = launch(['start', ...baseArgs])
  await waitForBanner(main1)
  assert.match(main1.stdout, /http:\/\/127\.0\.0\.1:/, 'the banner must print connectable URLs')
  assert.ok(
    !/\b0\.0\.0\.0\b/.test(main1.stdout),
    `the banner must not advertise the wildcard address\n${describeInstance(main1)}`,
  )
  log.info(`banner ok, pid ${main1.child.pid}`)

  log.step(2, TOTAL_STEPS, 'management API and console')
  const consoleResponse = await fetch(`http://127.0.0.1:${managementPort}/`)
  assert.equal(consoleResponse.status, 200, 'the console index must be served')
  assert.match(consoleResponse.headers.get('content-type') ?? '', /text\/html/, 'the console index must be text/html')
  // 命令行形态下页面是管理服务自己发的，凭证随入口 HTML 一并下发，页面才能请求 API。
  const consoleHtml = await consoleResponse.text()
  const injected = /window\.__OSW__=\{apiToken:"([^"]+)"/.exec(consoleHtml)
  assert.ok(injected, 'the served console must receive the management token')
  const apiToken = injected[1]
  // 注入给页面的那份必须**就是**磁盘上那份。两边对不上，页面会拿着一个自己以为
  // 对的凭证去撞 401——这种错在前端表现成「白屏」，很难查。
  assert.equal(readManagementToken(dataDir), apiToken, 'the injected token must be the one published on disk')
  const browserOrigin = `http://127.0.0.1:${managementPort}`
  // 无凭证 = 401。不带任何浏览器痕迹的那一种也一样——它曾经是本机进程的免费通行证，
  // 而 `Origin` / `Sec-Fetch-*` 都是调用方自己写的头，等于把门锁交给被拦的人。
  assert.equal(
    (await postJson(managementPort, '/api/provider/export')).status,
    401,
    'a local request without the token must be refused',
  )
  assert.equal(
    (await postJson(managementPort, '/api/proxy/status', { origin: browserOrigin })).status,
    401,
    'a browser request without the token must be refused',
  )
  // 错凭证 = 401。证明通过的不是「带了头」而是「带对了」。
  assert.equal(
    (await postJson(managementPort, '/api/proxy/status', { token: 'not-the-token' })).status,
    401,
    'a request with the wrong token must be refused',
  )
  // 带对凭证 = 200：`osw --web` 能用、`osw stop` / `osw status` 也能用的根本原因。
  const statusWithToken = await postJson(managementPort, '/api/proxy/status', { token: apiToken, origin: browserOrigin })
  assert.equal(statusWithToken.status, 200, `POST /api/proxy/status with the token → ${statusWithToken.status}`)
  assert.equal(statusWithToken.body?.success, true, 'the management API must answer with success: true')
  const localStatus = await postJson(managementPort, '/api/proxy/status', { token: apiToken })
  assert.equal(localStatus.status, 200, 'the same token must work without any browser headers')
  // `Host` 不是访问控制：带着攻击者域名的请求照样拿得到页面（前端产物本来就是公开的）。
  // 但它必须拿**不到**凭证——DNS rebinding 的全部杀伤力就在那行注入的 HTML 上。
  const rebound = await getWithHost(managementPort, '/', 'evil.example.com')
  assert.equal(rebound.status, 200, 'a non-loopback Host must still get the console')
  assert.ok(!rebound.body.includes('window.__OSW__'), 'a non-loopback Host must not receive the management token')
  assert.ok(consoleHtml.includes('window.__OSW__'), 'a loopback Host must receive the management token')
  assert.equal(fs.existsSync(runtimeFilePathOf(dataDir)), true, 'the runtime file must exist while running')
  log.info('management API and console answered')

  log.step(3, TOTAL_STEPS, 'status --json')
  const running = await readStatusJson(dataDir)
  assert.equal(running.state, 'running')
  assert.equal(running.pid, main1.child.pid, 'status must report the pid of the process it started')
  assert.equal(running.management.port, managementPort)
  assert.equal(running.proxy.port, proxyPort)
  assert.equal(typeof running.consoleUrl, 'string', 'consoleUrl must be present when the console is served')
  assert.equal(running.staleRuntimeFile, false)
  // 文本模式与 JSON 说的是同一件事：状态词也必须出现。
  const statusText = await runOnce(['status', '--data-dir', dataDir])
  assertExitCode(statusText, 0)
  assert.equal(statusText.stdout.trim().split('\n').length, 9, 'the text report must keep its 9-line layout')
  log.info('status reports a running instance')

  log.step(4, TOTAL_STEPS, 'a second start must be refused')
  const second = await runOnce(['start', '--no-web', '--data-dir', dataDir, '--proxy-port', String(spareProxyPort), '--management-port', String(spareManagementPort)])
  assertExitCode(second, 1)
  assert.equal(/\bCtrl\+C\b/.test(second.stdout), false, 'the refused instance must not print a banner')
  // 关键：被拒的那次**不能**动到运行时文件，否则第一个实例就失去被 `stop` 找到的坐标了。
  assert.equal(readRuntimeFile(dataDir).pid, main1.child.pid, 'the runtime file must still belong to the first instance')
  assert.equal(main1.child.exitCode, null, 'the first instance must survive the refused start')
  log.info('duplicate start refused and the running instance kept its runtime file')

  log.step(5, TOTAL_STEPS, 'stop')
  const stopped = await runOnce(['stop', '--data-dir', dataDir])
  assertExitCode(stopped, 0)
  await waitUntil(() => !fs.existsSync(runtimeFilePathOf(dataDir)), 5_000, () => 'the runtime file was not removed')
  assert.equal((await main1.exited).code, 0, 'SIGINT-less graceful shutdown must still exit 0')
  await waitUntil(async () => !(await isPortOpen(managementPort)) && !(await isPortOpen(proxyPort)), 5_000, () => 'the ports were not released')
  log.info('stopped, ports released, runtime file removed')

  log.step(6, TOTAL_STEPS, 'status after stop')
  const stoppedReport = await readStatusJson(dataDir)
  assert.equal(stoppedReport.state, 'stopped')
  assert.equal(stoppedReport.pid, null, 'a stopped instance must not report a pid')
  assert.equal(stoppedReport.management, null)
  assert.equal(stoppedReport.staleRuntimeFile, false)
  // 凭证文件必须跟着服务一起消失。留一份「上次启动的凭证」在目录里，等于让一个已经
  // 作废的秘密长期可读；而且下一次 `status` 会读到它就去敲一个不存在的服务。
  assert.equal(
    fs.existsSync(path.join(dataDir, 'management.token')),
    false,
    'stopping must remove the management token file',
  )
  const stopAgain = await runOnce(['stop', '--data-dir', dataDir])
  assertExitCode(stopAgain, 0) // 「本来就没在跑」是成功，不是失败
  log.info('status is clean and stop is idempotent')

  log.step(7, TOTAL_STEPS, 'a crashed instance must be recovered from')
  fs.writeFileSync(
    runtimeFilePathOf(dataDir),
    JSON.stringify(
      {
        pid: DEAD_PID,
        appVersion: '0.0.0',
        environment: 'production',
        managementHost: '127.0.0.1',
        managementPort,
        proxyHost: '127.0.0.1',
        proxyPort,
        webUrl: null,
        startedAt: new Date(0).toISOString(),
      },
      null,
      2,
    ),
  )
  const staleReport = await readStatusJson(dataDir)
  assert.equal(staleReport.state, 'stopped', 'a dead pid means the instance is not running')
  assert.equal(staleReport.staleRuntimeFile, true, 'the leftover must be reported, not silently ignored')
  assert.equal(staleReport.pid, null, 'a leftover must not leak the dead pid into the report')
  assert.equal(staleReport.instanceVersion, null)
  // 崩溃留下的总是一对：运行时文件与实例锁（名字与字段见 core 的 `runtime/instance-lock.ts`）。
  // 两份都写上去，第 8 步才算真的在「接管」而不是在空地起步。
  fs.writeFileSync(
    path.join(dataDir, 'instance.lock'),
    JSON.stringify({ pid: DEAD_PID, startedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString() }),
  )

  log.step(8, TOTAL_STEPS, 'start with --no-web')
  const main2 = launch(['start', '--no-web', ...baseArgs])
  await waitForBanner(main2)
  assert.equal(fs.existsSync(runtimeFilePathOf(dataDir)), true, 'a stale runtime file must be replaced, not reused')
  assert.equal(readRuntimeFile(dataDir).pid, main2.child.pid, 'the stale runtime file must be overwritten')
  // 这一步同时证明了「遗留的锁不会卡住下一次启动」——清理残留只发生在取锁那一刻，
  // 宿主（包括 `stop`）都不再插手。
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dataDir, 'instance.lock'), 'utf8')).pid,
    main2.child.pid,
    'the stale instance lock must be taken over by the new instance',
  )
  const noWebIndex = await fetch(`http://127.0.0.1:${managementPort}/`)
  assert.equal(noWebIndex.status, 404, '--no-web must not serve the console')
  // 页面没发出去，于是凭证只能从数据目录里读——`osw stop` / `osw status` 走的正是这条路。
  // 这一步因此同时证明了「没有页面也能用 API」与「凭证文件是真的能被另一个进程读到」。
  const stillAlive = await postJson(managementPort, '/api/proxy/status', { token: readManagementToken(dataDir) })
  assert.equal(stillAlive.status, 200, '--no-web must still expose the management API')
  assert.equal(stillAlive.body?.success, true, '--no-web must still expose the management API')
  assertExitCode(await runOnce(['stop', '--data-dir', dataDir]), 0)
  assert.equal(
    fs.existsSync(path.join(dataDir, 'management.token')),
    false,
    'the second instance must also remove its token file on the way out',
  )

  log.step(9, TOTAL_STEPS, 'usage errors')
  const jsonOnStop = await runOnce(['stop', '--json', '--data-dir', dataDir])
  assertExitCode(jsonOnStop, 2) // 用法错误固定 2，与「运行期失败」分开
  const jsonOnStart = await runOnce(['start', '--json', '--no-web', ...baseArgs])
  assertExitCode(jsonOnStart, 2)
  const unknown = await runOnce(['frobnicate', '--data-dir', dataDir])
  assertExitCode(unknown, 2)
  const help = await runOnce(['--help'])
  assertExitCode(help, 0)
  assert.match(help.stdout, /--json/)
  log.info('exit code semantics hold: 0 ok, 2 usage error')

  log.success('CLI smoke test passed')
  fs.rmSync(dataDir, { recursive: true, force: true })
}

try {
  await main()
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await cleanup()
}
