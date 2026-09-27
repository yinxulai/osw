import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'

// 宿主开发会话。
//
// 拆成两个包之后，「开发」不再是单个 `vite` 能搞定的事：渲染层由 `packages/console` 的
// dev server 提供，主进程、两个 preload 与服务进程由本包构建成 `output/command`，最后 Electron 把它们接起来。
// 顺序在 turbo 里表达不出来——`dev` 是长驻任务，turbo 只会并行启动它，不会等对方就绪——
// 所以「等控制台起来了再启动 Electron」这件事由这个脚本负责。

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(appDirectory, '..', '..')
const outputDirectory = path.join(appDirectory, 'output', 'command')
const mainBundlePath = path.join(outputDirectory, 'index.js')
// preload 与服务进程的入口也必须在，名字都是运行期约定（由各自的 vite 配置钉死）：
// 主 preload 缺了窗口没有桥，托盘 preload 缺了面板没有桥，服务脚本缺了核心起不来。
const preloadBundlePath = path.join(outputDirectory, 'preload.js')
const trayPanelPreloadBundlePath = path.join(outputDirectory, 'tray-panel-preload.js')
const serviceBundlePath = path.join(outputDirectory, 'service-main.mjs')

// 渲染层 dev server 地址。`packages/console/vite.config.ts` 里端口是写死的（strictPort），
// 端口漂移时 Vite 会直接失败，而不是安静地让 Electron 加载一张空白页。
const consoleDevUrl = process.env.CONSOLE_DEV_URL ?? 'http://localhost:5173'

// Electron 由本包声明，不从仓库根借：electron-builder 只认 `<projectDir>/node_modules/electron`
// （它不会逐级向上找），而打包时的 projectDir 就是本包。声明在根会让 dev 能用、打包失败。
const electronPath = createRequire(import.meta.url)('electron')

let electronProcess = null
const viteProcesses = []
let watcher = null
let restartTimer = null
let shuttingDown = false

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** 控制台的 dev server 起来之前，Electron 只会加载到失败页，所以先等它。 */
async function waitForConsoleServer() {
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    try {
      const response = await fetch(consoleDevUrl)
      if (response.status < 500) return
    } catch {
      // 还没监听：继续等
    }
    await sleep(500)
  }
  throw new Error(`Console dev server is not reachable at ${consoleDevUrl}`)
}

/** 本包四份产物的就绪信号。缺一个就不用起 Electron 了。 */
async function waitForBundles() {
  const required = [mainBundlePath, preloadBundlePath, trayPanelPreloadBundlePath, serviceBundlePath]
  for (let attempt = 1; attempt <= 1200; attempt += 1) {
    if (required.every(bundle => fs.existsSync(bundle))) return
    await sleep(100)
  }
  const missing = required.filter(bundle => !fs.existsSync(bundle))
  throw new Error(`Host bundles were not produced: ${missing.join(', ')}`)
}

/** 输出目录里最新的写入时间。没有产物时返回 null。 */
function latestWriteTime() {
  let latest = null
  for (const entry of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const { mtimeMs } = fs.statSync(path.join(outputDirectory, entry.name))
    if (latest === null || mtimeMs > latest) latest = mtimeMs
  }
  return latest
}

/**
 * 等首轮构建安稳下来。
 *
 * 产物目录里可能还留着上一次会话的文件（Electron 一看就绪会立刻启动），所以除了等
 * 「文件存在」，还得等「它不再变」：两次采样之间没有新写入，才算这一轮构建写完。
 */
async function waitForFirstBuildSettle() {
  for (let attempt = 1; attempt <= 300; attempt += 1) {
    const before = latestWriteTime()
    if (before === null) {
      await sleep(200)
      continue
    }
    await sleep(400)
    if (latestWriteTime() === before) return
  }
}

/**
 * 监听产物改动并重启 Electron。
 *
 * 挂上之后的头两秒丢弃事件：preload 与服务进程的首次构建比主进程晚落盘，而监听器只能在 Electron
 * 起来之后才挂，紧贴着挂就会把它们的首次写入当成「人改了代码」，凭空重启一次。这个窗口
 * 只影响启动那一瞬，之后的改动照常触发重启。
 */
function watchOutputDirectory() {
  const ignoreEventsUntil = Date.now() + 2000
  watcher = fs.watch(outputDirectory, { recursive: true }, () => {
    if (Date.now() < ignoreEventsUntil) return
    scheduleRestart()
  })
}

/**
 * 四个监听器：主进程、两个 preload、服务进程是四份配置、四次构建，但写入同一个目录。
 * `shell: true` 而不是自己拼 `cmd.exe /c`：这里只需要长驻子进程，
 * 不需要 `packages/toolkit/scripts/lib/run.mjs` 那套退出码与信号转发。
 */
function startViteWatchers() {
  const commands = [
    'pnpm exec vite build --watch',
    'pnpm exec vite build --watch --config vite.preload.config.ts',
    'pnpm exec vite build --watch --config vite.tray-panel.config.ts',
    'pnpm exec vite build --watch --config vite.server.config.ts',
  ]
  for (const command of commands) {
    const child = spawn(command, { cwd: appDirectory, stdio: 'inherit', shell: true })
    viteProcesses.push(child)
    child.on('exit', code => {
      viteProcesses.splice(viteProcesses.indexOf(child), 1)
      if (!shuttingDown) {
        log.error(`Build watcher exited with code ${code}: ${command}`)
        shutdown(1)
      }
    })
  }
}

function stopElectron() {
  if (!electronProcess) return
  const child = electronProcess
  electronProcess = null
  child.removeAllListeners('exit')
  child.kill()
}

function startElectron() {
  stopElectron()
  log.info(`starting Electron (renderer: ${consoleDevUrl})`)
  electronProcess = spawn(electronPath, [appDirectory, '--no-sandbox'], {
    cwd: appDirectory,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: consoleDevUrl },
  })
  electronProcess.on('exit', code => {
    electronProcess = null
    // 手动关窗即视为结束本次开发会话；重启走的是 stopElectron()，不会走到这里。
    if (!shuttingDown) shutdown(code ?? 0)
  })
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer)
  // 一次改动会引发一串文件事件，而且四份构建是先后完成的：主进程约 0.1s、两个 preload
  // 约 1s、服务进程约 1.2s，每次写入都会重置这个计时器，所以等到最后一次写入后 1.5s
  // 才真的重启——一次编辑只会重启一次。窗口给短了（试过 300ms）就会变成「主进程构建完重启一次、preload 构建完再重启一次」。
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (!fs.existsSync(mainBundlePath)) return
    log.info('main process changed, restarting Electron')
    startElectron()
  }, 1500)
}

function shutdown(exitCode) {
  if (shuttingDown) return
  shuttingDown = true
  if (watcher) watcher.close()
  if (restartTimer) clearTimeout(restartTimer)
  stopElectron()
  for (const child of viteProcesses) child.kill()
  process.exit(exitCode)
}

async function main() {
  log.title('OSW development')
  log.info(`host: ${path.relative(repositoryRoot, appDirectory)}`)

  await waitForConsoleServer()
  log.info('console dev server is ready')

  startViteWatchers()
  await waitForBundles()
  await waitForFirstBuildSettle()
  startElectron()
  watchOutputDirectory()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

main().catch(error => {
  log.error(error.message)
  shutdown(1)
})
