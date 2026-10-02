import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'
import { run } from '../../../packages/toolkit/scripts/lib/run.mjs'

// 宿主构建。
//
//   node scripts/build.mjs                    只构建本包的产物（主进程、两个 preload、服务进程、截图补拍入口）
//   node scripts/build.mjs --package          构建后交给 electron-builder 打包
//   node scripts/build.mjs --package --win    打包指定平台（其余参数原样透传）
//
// 清空输出目录由这里负责而不是交给 Vite 的 `emptyOutDir`：几次构建共用 `output/command`，
// 任何一次对自己做 emptyOutDir 都会抹掉另外几次的产物
// （`--watch` 下尤其明显：改主进程会把 preload.js 删掉而不会重建）。

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(appDirectory, 'output')

const arguments_ = process.argv.slice(2)
const shouldPackage = arguments_.includes('--package')
const electronBuilderArguments = arguments_.filter(argument => argument !== '--package')

// 五次构建：主进程（ESM）、两个 preload（CJS）、核心服务进程（ESM）、截图补拍入口（ESM）。
// 顺序不重要，但都在清空目录之后。服务进程必须单独一份构建，因为它可以 import
// `node:sqlite`，而主进程那份产物里出现它就等于主进程会卡（见 issue #9）。
// 截图补拍入口同样单独编：主进程不需要懂它，但 `pnpm screenshots` 需要它在
// `output/command` 里（见 `source/screenshot-export-entry.ts`）。
const viteSteps = [
  { label: 'preload', args: ['exec', 'vite', 'build', '--config', 'vite.preload.config.ts'] },
  { label: 'main process', args: ['exec', 'vite', 'build'] },
  { label: 'service process', args: ['exec', 'vite', 'build', '--config', 'vite.server.config.ts'] },
  { label: 'tray panel preload', args: ['exec', 'vite', 'build', '--config', 'vite.tray-panel.config.ts'] },
  { label: 'screenshot export', args: ['exec', 'vite', 'build', '--config', 'vite.screenshot.config.ts'] },
]

const main = async () => {
  log.title('Building OSW host')

  fs.rmSync(outputDirectory, { recursive: true, force: true })
  for (const step of viteSteps) {
    await run('pnpm', step.args, { cwd: appDirectory })
    log.info(`${step.label} built`)
  }

  log.success('Main process, preloads and service process built')

  if (!shouldPackage) return

  // electron-builder 以本包为 projectDir，所以必须在 `apps/app` 下运行：
  // 配置里的图标、`afterPack`、输出目录都是相对它解析的。
  // 渲染层静态产物由 `packages/console` 构建，配置里用 `files` 映射进 asar。
  await run(
    'pnpm',
    ['exec', 'electron-builder', '--config', 'electron-builder.config.cjs', '--publish', 'never', ...electronBuilderArguments],
    { cwd: appDirectory },
  )
  log.success('Package created')
}

main().catch(error => {
  log.error(error.message)
  process.exit(1)
})
