import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'
import { run } from './lib/run.mjs'

// 一条命令跑完全部静态检查。检查项本身各有归属（ESLint 配置在根、代理分层在 core），
// 所以这里只做编排，不关心它们各自住在哪里；工作目录钉死在仓库根，
// 不依赖调用方从哪里执行。
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const main = async () => {
  log.title('Linting')
  try {
    // `--cache` 只跳过「内容与配置都没变」的文件，缓存过期最多是多跑一遍；
    // 位置放进 node_modules/.cache 而不是仓库根，免得 `.eslintcache` 变成常驻的未跟踪文件。
    await run('pnpm', ['exec', 'eslint', '.', '--cache', '--cache-location', 'node_modules/.cache/eslintcache'], { cwd: repositoryRoot })
    // 用 process.execPath 而不是 'node'：Windows 上 run() 会给裸命令补 .cmd，`node.cmd` 并不存在。
    // 代理分层规则属于 core（改代理的人必须能自己跑它），所以脚本放在那个包里。
    await run(process.execPath, ['packages/core/scripts/check-proxy-layers.mjs'], { cwd: repositoryRoot })
    await run(process.execPath, ['packages/core/scripts/check-database-boundaries.mjs'], { cwd: repositoryRoot })
    await run(process.execPath, ['packages/toolkit/scripts/check-package-boundaries.mjs'], { cwd: repositoryRoot })
    // 版本号写在仓库根与每一个 workspace 包的 manifest 里，而「哪几份会被提交」归
    // `release.yml` 里那行 `git add` 管——那是这条链路上唯一不是代码的清单。
    // 放在这里而不是单开一个 job：漏提交一份，下一次 CI 就是红的，
    // 不必等发布之后靠人回头读一遍仓库（来龙去脉见 apps/docs/product/packaging.md §5.8）。
    await run(process.execPath, ['packages/toolkit/scripts/version.mjs', '--check'], { cwd: repositoryRoot })
    log.success('Lint passed')
  } catch (error) {
    log.error('Lint failed')
    process.exit(1)
  }
}

main()
