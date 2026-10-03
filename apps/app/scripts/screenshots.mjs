import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuntimeProfile } from '@osw/contracts/runtime-profile'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'
import { isManagementApiReachable, waitForConsoleServer } from './lib/console-dev-server.mjs'

// 重拍截图。
//
//   pnpm screenshots                                 拍默认编排（`site`，6 页 × 2 语言 × 2 主题 = 24 张）
//   pnpm screenshots -- --set=docs                   拍文档编排（8 张整窗 + 10 张局部 × 2 语言 × 亮色 = 36 张）
//   pnpm screenshots -- --only=06-client-config      在选定 set 内只补一张（按 `shot.fileName`）
//   pnpm screenshots -- --set=docs --with=02-smart-routing   把任意 set 里的某张追加进来
//
// 编排定义在 `source/screenshot-sets.ts`：一份 set = 一组页面 + 语言/主题 + 用途说明。
// 落盘目录按 set 派生（见 `SET_OUTPUT_DIRECTORIES`），脚本只负责把入口跑起来——真正的取景
// 逻辑在主进程里（`source/screenshot-export.ts`），同一段代码也被开发版设置页的「一键重拍」调用。
//
// 前提是渲染层 dev server 已经在跑（`pnpm dev`）。截图窗口加载的是它，页面数据来自
// 已经起着的管理服务；这一步不启动服务进程、不动数据目录，也不碰任何正在运行的应用。

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(appDirectory, '..', '..')
const entryPath = path.join(appDirectory, 'output', 'command', 'screenshot-export.js')
const consoleDevUrl = process.env.CONSOLE_DEV_URL ?? 'http://localhost:5173'
const managementApiUrl = getRuntimeProfile('development').managementApiUrl

// 每份 set 的落盘目录（相对仓库根）。用途不同、读者不同，所以目录也分开：
//   - `site` → `snapshot/`：官网与两个 README 直接 import 它；
//   - `docs` → `apps/docs/public/screenshots/`：Clarify 会把它逐字复制进站点产物，
//     MDX 里按 `/screenshots/<locale>/<fileName>.png` 引用。
const SET_OUTPUT_DIRECTORIES = {
  site: 'snapshot',
  docs: 'apps/docs/public/screenshots',
}

// Electron 由本包声明（与 `scripts/dev.mjs` 同一条理由：electron-builder 只认本包的 node_modules）。
const electronPath = createRequire(import.meta.url)('electron')

function runElectron(params) {
  const { setName, only, withShots, outputDirectory } = params
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [entryPath, '--no-sandbox'], {
      cwd: appDirectory,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: consoleDevUrl,
        SCREENSHOT_OUTPUT_DIR: outputDirectory,
        SCREENSHOT_SET: setName,
        ...(only ? { SCREENSHOT_ONLY: only } : {}),
        ...(withShots ? { SCREENSHOT_WITH: withShots } : {}),
      },
    })
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`screenshot export exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

/** 取 `--name=value` 形式的参数值。 */
function argumentValue(name) {
  return process.argv
    .slice(2)
    .find(argument => argument.startsWith(`--${name}=`))
    ?.slice(`--${name}=`.length)
}

const main = async () => {
  log.title('Exporting screenshots')

  const setName = argumentValue('set') ?? 'site'
  const only = argumentValue('only')
  const withShots = argumentValue('with')

  if (!(setName in SET_OUTPUT_DIRECTORIES)) {
    // 这里先拦一道，是因为「未知 set」在脚本侧只影响落盘目录的选择——真正校验 set 合法性
    // 的是入口（它拿 `screenshot-sets.ts` 的编排）。挡在更早一步，错误信息更好懂。
    const known = Object.keys(SET_OUTPUT_DIRECTORIES).join(', ')
    throw new Error(`unknown set "${setName}"; known sets: ${known} (see source/screenshot-sets.ts)`)
  }
  const outputDirectory = path.join(repositoryRoot, SET_OUTPUT_DIRECTORIES[setName])

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

  log.info(`set: ${setName} → ${path.relative(repositoryRoot, outputDirectory) || '.'}`)
  log.info(`renderer: ${consoleDevUrl}`)
  if (only) log.info(`only: ${only}`)
  if (withShots) log.info(`with: ${withShots}`)

  // 页面能画出来，但数据来自管理服务；它不在时截出来会是一批空列表，早点提醒。
  if (await isManagementApiReachable(managementApiUrl)) {
    log.info(`management api: ${managementApiUrl}`)
  } else {
    log.warn(`management api not reachable at ${managementApiUrl} — pages may render empty`)
  }

  await runElectron({ setName, only, withShots, outputDirectory })
  log.success(`Screenshots written to ${path.relative(repositoryRoot, outputDirectory)}/`)
}

main().catch(error => {
  log.error(error.message)
  process.exit(1)
})
