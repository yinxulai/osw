import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'

// 重拍官网截图。
//
//   pnpm screenshots                                 拍全清单（6 页 × 2 语言 × 2 主题 = 24 张）
//   pnpm screenshots -- --only=06-client-config      只补一张（按 `SHOTS` 里的 fileName）
//
// 这里只负责把入口跑起来：真正的取景逻辑在主进程里（`source/screenshot-export.ts`），
// 同一段代码也被开发版设置页的「一键重拍」调用，两条路不会分叉。
//
// 前提是渲染层 dev server 已经在跑（`pnpm dev`）。截图窗口加载的是它，页面数据来自
// 已经起着的管理服务；这一步不启动服务进程、不动数据目录，也不碰任何正在运行的应用。

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(appDirectory, '..', '..')
const entryPath = path.join(appDirectory, 'output', 'command', 'screenshot-export.js')
const consoleDevUrl = process.env.CONSOLE_DEV_URL ?? 'http://localhost:5173'

// Electron 由本包声明（与 `scripts/dev.mjs` 同一条理由：electron-builder 只认本包的 node_modules）。
const electronPath = createRequire(import.meta.url)('electron')

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** 页面必须从 dev server 取，起不来就只会拍到一张错误页，所以先在命令行这层挡掉。 */
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
  throw new Error(`Console dev server is not reachable at ${consoleDevUrl} (start it with: pnpm dev)`)
}

function runElectron(only) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [entryPath, '--no-sandbox'], {
      cwd: appDirectory,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: consoleDevUrl,
        SCREENSHOT_OUTPUT_DIR: path.join(repositoryRoot, 'snapshot'),
        ...(only ? { SCREENSHOT_ONLY: only } : {}),
      },
    })
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`screenshot export exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

const main = async () => {
  log.title('Exporting website screenshots')

  const only = process.argv
    .slice(2)
    .find(argument => argument.startsWith('--only='))
    ?.slice('--only='.length)

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Screenshot entry not found: ${path.relative(repositoryRoot, entryPath)} (run: pnpm build)`)
  }

  await waitForConsoleServer()
  log.info(`renderer: ${consoleDevUrl}`)
  if (only) log.info(`only: ${only}`)

  await runElectron(only)
  log.success('Screenshots written to snapshot/')
}

main().catch(error => {
  log.error(error.message)
  process.exit(1)
})
