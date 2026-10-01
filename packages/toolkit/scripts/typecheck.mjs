import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'
import { run } from './lib/run.mjs'

// 一次覆盖全部包：`tsconfig.check.json`（本包根目录）把五棵 `source` 树与构建配置
// 放在同一个程序里。逐包做类型检查需要每个包自己声明 paths，收益不大，
// 反而多出四个会腐烂的配置。
//
// 配置与本脚本同属一个包：两个文件都是「只有这个脚本会读」的东西，
// 放在一起才能一眼看出它们谁是消费者、谁是被读的。
//
// 注意 `include` 的语义：`tsc` 对指向空气的条目**静默成功**（不报错、不提示，只是那份
// 文件不再被检查），所以**改文件名时必须同步改它**。不要再为此加一道「校验每条 `include`
// 都落到实文件」的前置检查：那是拿补丁替代约束，一旦开始加就加不完（见
// apps/docs/specs/packaging.md §7 的工程约定）。
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const main = async () => {
  log.title('Type checking')
  try {
    await run('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'packages/toolkit/tsconfig.check.json'], { cwd: repositoryRoot })
    log.success('Type check passed')
  } catch (error) {
    log.error('Type check failed')
    process.exit(1)
  }
}

main()
