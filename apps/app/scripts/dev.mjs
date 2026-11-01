import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'
import { waitForConsoleServer } from './lib/console-dev-server.mjs'

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

/**
 * 首轮构建的等待上限。服务进程那一份约 1.6s，留足两个数量级的余量；
 * 冷启动装依赖或杀毒软件实时扫描时可能慢上几十秒，超时只是报警，不是失败退出。
 */
const FIRST_BUILD_TIMEOUT_MILLIS = 120_000

/**
 * 监听产物改动并重启 Electron。
 *
 * 现在只留一个很短的丢弃窗口：调用它时五份首轮构建都已经宣告完成，理论上不会再有
 * 「自己人」的写入，但 `fs.watch` 在 Windows 上挂载瞬间仍可能把注册之前发生的事件
 * 延迟投递过来，半秒足够吸收这点抖动，又不至于吞掉人手改代码。
 */
function watchOutputDirectory() {
  const ignoreEventsUntil = Date.now() + 500
  watcher = fs.watch(outputDirectory, { recursive: true }, () => {
    if (Date.now() < ignoreEventsUntil) return
    scheduleRestart()
  })
}

/**
 * 启动一个 vite 构建监听，并在它的**首轮构建真的跑完**时兑现。
 *
 * 这里不用「产物文件存在」当就绪信号：`output/command` 会跨会话留存，上一次的
 * `index.js`、`service-main.mjs` 还在，于是「文件都在」在开跑那一瞬就成立，Electron
 * 会先拿旧包起来，等首轮构建落盘后再被当成「人改了代码」重启一次——用户看到的就是
 * 窗口闪一下、先出现又被杀死再出现。
 *
 * vite 在 `build --watch` 下每轮构建结束都会打一行 `built in NNms.`，那是真正的完成
 * 信号，拿它当就绪条件，顺序就变成确定的：先构建完，再起窗口，一次都不重启。
 *
 * 代价是要自己转发子进程输出（`stdio: 'inherit'` 拿不到可读管道）。副作用是 vite
 * 检测不到 TTY 就不再上色，日志进文件时反而干净了。
 */
function startViteWatcher(command) {
  return new Promise(resolve => {
    const child = spawn(command, { cwd: appDirectory, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    viteProcesses.push(child)

    let firstBuildSettled = false
    let pending = ''
    const settleFirstBuild = () => {
      if (firstBuildSettled) return
      firstBuildSettled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      log.warn(`First build is taking unusually long (>${FIRST_BUILD_TIMEOUT_MILLIS / 1000}s): ${command}`)
      settleFirstBuild()
    }, FIRST_BUILD_TIMEOUT_MILLIS)

    // 按行扫描而不是整块匹配：`built in` 可能被 chunk 边界切成两半。
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      stream.on('data', chunk => {
        process.stdout.write(chunk)
        if (firstBuildSettled) return
        pending += chunk
        let newlineIndex = pending.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = pending.slice(0, newlineIndex)
          pending = pending.slice(newlineIndex + 1)
          if (line.includes('built in ')) {
            settleFirstBuild()
            return
          }
          newlineIndex = pending.indexOf('\n')
        }
      })
    }

    child.on('exit', code => {
      viteProcesses.splice(viteProcesses.indexOf(child), 1)
      if (!shuttingDown) {
        log.error(`Build watcher exited with code ${code}: ${command}`)
        shutdown(1)
      }
    })
  })
}

/**
 * 五个监听器：主进程、两个 preload、服务进程、截图补拍入口是五份配置、五次构建，但写入同一个目录。
 * `shell: true` 而不是自己拼 `cmd.exe /c`：这里只需要长驻子进程，
 * 不需要 `packages/toolkit/scripts/lib/run.mjs` 那套退出码与信号转发。
 *
 * 返回的 promise 在**全部五份**首轮构建完成后兑现：Electron 缺任何一份都起不来，
 * 少等一份只是把闪一下推迟到那一份落盘的时候。
 */
async function startViteWatchers() {
  const commands = [
    'pnpm exec vite build --watch',
    'pnpm exec vite build --watch --config vite.preload.config.ts',
    'pnpm exec vite build --watch --config vite.tray-panel.config.ts',
    'pnpm exec vite build --watch --config vite.server.config.ts',
    'pnpm exec vite build --watch --config vite.screenshot.config.ts',
  ]
  await Promise.all(commands.map(startViteWatcher))
  // 构建说自己成功，产物却不在，说明配置里的 outDir 或文件名漂了。宁可现在报错，
  // 也不要让 Electron 打开一张 `did-fail-load` 的错误页。
  const required = [mainBundlePath, preloadBundlePath, trayPanelPreloadBundlePath, serviceBundlePath]
  const missing = required.filter(bundle => !fs.existsSync(bundle))
  if (missing.length > 0) throw new Error(`Host bundles were not produced: ${missing.join(', ')}`)
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

  log.info('waiting for console dev server ...')
  await waitForConsoleServer({ consoleDevUrl })
  log.info('console dev server is ready')

  // 顺序写死成「先等五份产物都构建完，再开窗」：反过来会先用上一次的旧包把窗口拉起来，
  // 首轮构建落盘后再重启一次，那就是「闪一下」。
  log.info('building host bundles ...')
  await startViteWatchers()
  log.info('host bundles are ready')
  startElectron()
  watchOutputDirectory()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

main().catch(error => {
  log.error(error.message)
  shutdown(1)
})
