import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuntimeProfile } from '@osw/contracts/runtime-profile'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'
import { isManagementApiReachable, waitForConsoleServer } from './lib/console-dev-server.mjs'

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
const managementApiUrl = getRuntimeProfile('development').managementApiUrl

// Electron 由本包声明（与 `scripts/dev.mjs` 同一条理由：electron-builder 只认本包的 node_modules）。
const electronPath = createRequire(import.meta.url)('electron')

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

  // 先说清楚在等什么：以前这里一声不响地轮询两分钟，观感就是「卡住了」。
  log.info(`waiting for renderer dev server at ${consoleDevUrl} ...`)
  await waitForConsoleServer({
    consoleDevUrl,
    onWait: ({ elapsedMillis }) => {
      if (elapsedMillis > 0 && Math.round(elapsedMillis / 1000) % 5 === 0) {
        process.stdout.write(`\r  still waiting (${Math.round(elapsedMillis / 1000)}s) ...`)
      }
    },
  })
  process.stdout.write('\r')

  log.info(`renderer: ${consoleDevUrl}`)
  if (only) log.info(`only: ${only}`)

  // 页面能画出来，但数据来自管理服务；它不在时截出来会是一批空列表，早点提醒。
  if (await isManagementApiReachable(managementApiUrl)) {
    log.info(`management api: ${managementApiUrl}`)
  } else {
    log.warn(`management api not reachable at ${managementApiUrl} — pages may render empty`)
  }

  await runElectron(only)
  log.success('Screenshots written to snapshot/')
}

main().catch(error => {
  log.error(error.message)
  process.exit(1)
})
