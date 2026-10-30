import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'

// 发布前把迁移基线搬进包内。
//
// `packages/core/source/database/index.ts` 的 `getMigrationsFolder()` 是按**相对目录层级**
// 从当前模块往上找 `packages/core/drizzle/<role>`（见 packaging.md §5.7）。安装后的模块路径是
// `<prefix>/node_modules/osw-cli/output/index.js`，往上只有包目录本身，所以基线必须出现在
// `osw-cli/packages/core/drizzle/**` 这个位置——层级不能改，只能把文件搬过去。
//
// npm 的 `files` 不允许引用包目录之外，所以这一步是 `prepack` 而不是构建产物的一部分：
// 只在打包时执行，仓库里不留副本（`apps/cli/packages/` 已 gitignore）。

const cliDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = path.resolve(cliDirectory, '../../packages/core/drizzle')
const targetDirectory = path.join(cliDirectory, 'packages/core/drizzle')
const roles = ['config', 'data']

const main = () => {
  log.title('Staging CLI migrations')

  for (const role of roles) {
    const from = path.join(sourceDirectory, role)
    if (!fs.existsSync(from)) {
      log.error(`migrations not found at ${from}`)
      process.exit(1)
    }
  }

  fs.rmSync(path.join(cliDirectory, 'packages'), { recursive: true, force: true })
  fs.mkdirSync(targetDirectory, { recursive: true })
  for (const role of roles) {
    fs.cpSync(path.join(sourceDirectory, role), path.join(targetDirectory, role), { recursive: true })
  }

  log.success(`migrations staged to ${targetDirectory}`)
}

main()
