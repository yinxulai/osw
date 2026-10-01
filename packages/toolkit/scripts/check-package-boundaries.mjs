import { readdir, readFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'

// 包边界校验。
//
// 目录是不是「包」，只写在文档里没有约束力：跨包 import 能编译、能测试，
// 直到想把 core 单独发布或想在 CLI 里复用时才发现拆不开。这里把
// contract / core / console / cli / app 的依赖方向变成可执行的检查。
//
// 规则表（`RULES`）是声明式的：包边界见 apps/docs/product/packaging.md §3，任何一次搬目录
// 或新包都要在同一份表里表达出来，边界被顺手弄脏会立刻失败。
//
// 与 check-proxy-layers.mjs 同一思路：静态 import 检查，新增文件自动纳入，不维护白名单。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * 每个包的根目录候选，按顺序取第一个存在的；一个候选都不存在时跳过该包。
 *
 * `cli` 在 S2 建包前没有任何候选命中，所以它的规则分支目前是空跑——
 * 规则先写好，建包时立即生效。
 */
const PACKAGE_ROOTS = {
  contracts: ['packages/contracts/source'],
  core: ['packages/core/source'],
  console: ['packages/console/source'],
  api: ['apps/apis/source'],
  cli: ['apps/cli/source'],
  app: ['apps/app/source'],
}

/** 包之间的禁止依赖。app 是终端宿主，可以依赖全部。 */
const RULES = {
  contracts: {
    summary: '共享契约只描述形状，不依赖任何实现，也不依赖 Node 或 Electron',
    forbiddenPackages: ['core', 'console', 'cli', 'app'],
    forbiddenSpecifiers: [
      { pattern: /^electron$/, why: '契约包被浏览器打包，不得依赖 Electron' },
      { pattern: /^node:/, why: '契约包被浏览器打包，不得依赖 Node 内置模块' },
    ],
  },
  core: {
    summary: '核心能力不知道宿主是谁，必须能脱离 Electron 单独运行',
    forbiddenPackages: ['console', 'cli', 'app'],
    forbiddenSpecifiers: [
      { pattern: /^electron$/, why: '核心包要能作为 CLI / 无头服务运行，不得依赖 Electron' },
    ],
  },
  console: {
    summary: '控制台只通过管理 API 与核心通信，宿主能力走 platform 抽象层',
    forbiddenPackages: ['core', 'cli', 'app'],
    forbiddenSpecifiers: [
      { pattern: /^electron$/, why: '控制台不得直接依赖 Electron，宿主能力见 apps/docs/product/packaging.md §5.4' },
    ],
  },
  api: {
    summary: '上报端点跑在 Worker 的 isolate 里，只用共享契约，不碰任何一边的实现',
    forbiddenPackages: ['core', 'console', 'cli', 'app'],
    forbiddenSpecifiers: [
      { pattern: /^electron$/, why: 'Worker 里没有 Electron' },
      { pattern: /^node:/, why: 'Worker 默认不是 Node 运行时；要放开必须先在 wrangler.toml 里加 nodejs_compat' },
    ],
  },
  cli: {
    summary: 'CLI 只做宿主适配与参数解析，不写业务逻辑',
    forbiddenPackages: ['console', 'app'],
    forbiddenSpecifiers: [
      { pattern: /^electron$/, why: 'CLI 不得依赖 Electron' },
    ],
  },
  app: {
    summary: '桌面宿主可以依赖全部包',
    forbiddenPackages: [],
    forbiddenSpecifiers: [],
  },
}

/** 别名到包的映射。历史别名（`@common` / `@server` / `@render` / `@`）与包名别名并存。 */
const ALIASES = [
  { pattern: /^@common(\/|$)/, packageName: 'contracts' },
  { pattern: /^@osw\/contracts(\/|$)/, packageName: 'contracts' },
  { pattern: /^@server(\/|$)/, packageName: 'core' },
  { pattern: /^@osw\/core(\/|$)/, packageName: 'core' },
  { pattern: /^@render(\/|$)/, packageName: 'console' },
  { pattern: /^@(\/|$)/, packageName: 'console' },
  { pattern: /^@osw\/console(\/|$)/, packageName: 'console' },
  { pattern: /^@osw\/api(\/|$)/, packageName: 'api' },
  { pattern: /^@osw\/cli(\/|$)/, packageName: 'cli' },
  { pattern: /^@osw\/app(\/|$)/, packageName: 'app' },
]

/** 所有 `from '...'` / `import('...')` / `require('...')` 的模块说明符。 */
const IMPORT_PATTERN = /(?:from|import\(|require\()\s*'([^']+)'/g

/** 解析实际存在的包根目录，返回「包名 → 绝对路径（posix 形式）」。 */
function resolvePackageRoots() {
  const resolved = {}
  for (const [packageName, candidates] of Object.entries(PACKAGE_ROOTS)) {
    for (const candidate of candidates) {
      const absolute = path.join(root, candidate)
      if (fs.existsSync(absolute)) {
        resolved[packageName] = absolute.replaceAll(path.sep, '/')
        break
      }
    }
  }
  return resolved
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(target)))
      continue
    }
    // 测试文件为了搭夹具可以 import 任意模块，边界约束只作用于源码。
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(target)
    }
  }
  return files
}

function readSpecifiers(source) {
  const specifiers = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    specifiers.push(match[1])
  }
  return specifiers
}

/** 判断绝对路径属于哪个包，不在任何包根内时返回 null。 */
function resolveOwner(absolutePath, packageRoots) {
  const normalized = absolutePath.replaceAll(path.sep, '/')
  for (const [packageName, packageRoot] of Object.entries(packageRoots)) {
    if (normalized === packageRoot || normalized.startsWith(`${packageRoot}/`)) return packageName
  }
  return null
}

/**
 * 把说明符归一成「目标包」。
 *
 * 相对导入必须解析后再判断，否则一个 `../../common/x` 就能绕开全部别名规则；
 * 解析不出归属的（如包外资源 `../build/icon.png`）返回 null，不猜。
 */
function resolveTarget(specifier, file, packageRoots) {
  if (specifier.startsWith('.')) {
    return resolveOwner(path.resolve(path.dirname(file), specifier), packageRoots)
  }
  const alias = ALIASES.find(item => item.pattern.test(specifier))
  if (alias) return alias.packageName
  return null
}

async function main() {
  log.title('Package boundary check')

  const packageRoots = resolvePackageRoots()
  const violations = []
  let checked = 0

  for (const [packageName, rule] of Object.entries(RULES)) {
    const packageRoot = packageRoots[packageName]
    if (!packageRoot) continue

    const files = await collectSourceFiles(packageRoot)
    for (const file of files) {
      checked += 1
      const relative = path.relative(root, file).replaceAll(path.sep, '/')
      for (const specifier of readSpecifiers(await readFile(file, 'utf8'))) {
        const target = resolveTarget(specifier, file, packageRoots)
        if (target && target !== packageName && rule.forbiddenPackages.includes(target)) {
          violations.push(`${packageName}：${relative} → ${specifier}（不得依赖 ${target} 包）`)
          continue
        }
        const hit = rule.forbiddenSpecifiers.find(item => item.pattern.test(specifier))
        if (hit) {
          violations.push(`${packageName}：${relative} → ${specifier}（${hit.why}）`)
        }
      }
    }
    log.info(`${packageName}: ${rule.summary}`)
  }

  if (violations.length > 0) {
    log.error(`Package boundary check failed（${violations.length} 处越界）`)
    for (const violation of violations) {
      console.log(`  ${violation}`)
    }
    process.exit(1)
  }

  log.success(`Package boundaries respected（${checked} files）`)
}

main()
