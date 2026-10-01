import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'
import { run } from '../../../packages/toolkit/scripts/lib/run.mjs'

// 命令行宿主构建。两步，顺序不能换：
//
//   1. `vite build` → `output/index.js`（`bin` 入口）与按需加载的分包
//   2. `packages/console/output` → `output/web`（`--web` 时由管理服务托管的控制台产物）
//
// 第 2 步是「拷别人的产物」而不是「构建前端」：控制台只编一份，两种宿主共用
// （见 apps/docs/product/packaging.md §2）。所以构建顺序有依赖——`package.json` 把
// `@osw/console` 放在 devDependencies 里，让 Turbo 的 `^build` 先把它构建出来；
// 这个依赖**只是产物依赖，不是 import**，包边界检查管的是后者。

const cliDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(cliDirectory, 'output')
const consoleOutputDirectory = path.resolve(cliDirectory, '../../packages/console/output')
const webDirectory = path.join(outputDirectory, 'web')

const main = async () => {
  log.title('Building OSW CLI')

  fs.rmSync(outputDirectory, { recursive: true, force: true })
  await run('pnpm', ['exec', 'vite', 'build'], { cwd: cliDirectory })
  log.info('cli entry built')

  // 缺产物就报错停下，不产出一个「能启动但打开是空白页」的 CLI——那种失败要到用户
  // 打开浏览器时才看得见。开发期单独跑 CLI 构建时，先 `pnpm --filter @osw/console run build`。
  const consoleIndex = path.join(consoleOutputDirectory, 'index.html')
  if (!fs.existsSync(consoleIndex)) {
    log.error(`console artifacts not found at ${consoleIndex}; build packages/console first`)
    process.exit(1)
  }
  fs.cpSync(consoleOutputDirectory, webDirectory, { recursive: true })
  log.info(`console artifacts copied to ${webDirectory}`)

  log.success('CLI built')
}

main().catch(error => {
  log.error(error.message)
  process.exit(1)
})
