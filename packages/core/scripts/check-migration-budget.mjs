import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../toolkit/scripts/lib/log.mjs'

// 迁移「额度」检查：一个 PR 合计最多新增**一条**迁移。
//
// 为什么要有这条闸门：迁移目录名就是兼容性契约（运行时迁移器按目录名判定是否已应用），
// 而链上每多一个节点，就多一份永久要维护、要解释、要被新库按顺序重放的历史。
// 允许「一个 PR 随手拆三条」，等于允许把一次结构变化拆成三次半成品演进——评审要读的
// DDL 变成三段互相依赖的片段，而其中任何一段单独存在都没有意义。一个 PR = 一条迁移，
// 逼着作者把「这次到底改了什么」想清楚，再一次性写完整。
//
// 额度是**整个 PR 合计一条**，两个库加起来算——不是每个库各一条，也不看改动范围有多大。
// 跨库特性（既要建配置表、又要在日志表上记它的 id）本来就是两次结构变化，必须拆成两个 PR：
// 先落地只含结构的那一半，再在它之上放功能代码。做不到就说明这次改动本该分期。
//
// 检查方式是对比 git 里的 base 分支，而不是读磁盘——「这条迁移是不是本次新增的」只有
// 版本控制知道。这带来一个必然的退化路径：拿不到 base（浅克隆、tar 包分发、不在 git 仓库里）
// 就没法判断，此时**跳过并告警**，而不是假装通过或直接报错。CI 的 lint job 用
// fetch-depth: 0 检出，保证这条检查在唯一的把关点上真的会跑。
//
// 顺带守住另外两件事：已进入 base 的迁移目录**不许改、不许删**。目录名一动，已有库
// 就会把它当成新迁移重放；内容一改，`__drizzle_migrations` 里的 hash 与实际执行过的
// DDL 就对不上，事后复盘会读到一份从未运行过的「历史」。要修错就追加一条新迁移。

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// 两个库各有自己的链：`drizzle/config` 与 `drizzle/data`。
const roles = ['config', 'data']
const migrationRoot = 'packages/core/drizzle'
const maxNewMigrations = 1

// 「显式指定」的 base：给了就必须能解析。堆叠 PR（base 不是 main）全靠它，
// 静默回落到 main 会把「相对前置分支只新增一条」误判成「相对 main 新增两条」。
//   - `OSW_MIGRATION_BASE_REF`：本地/CI 手动传，写法随意（`origin/x`、`x`、sha 都行）。
//   - `GITHUB_BASE_REF`：GitHub 只在 `pull_request` 事件里注入，且是裸分支名。
const explicitBaseCandidates = [
  process.env.OSW_MIGRATION_BASE_REF,
  process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
].filter(Boolean)

// 没人指定时才用的兜底：常规 PR 就开向 main。
const fallbackBaseCandidates = ['origin/main', 'main']

function git(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** 在候选列表里逐个试，返回第一个能解析成 commit 的 ref。 */
function firstResolvable(candidates) {
  for (const candidate of candidates) {
    try {
      const sha = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]).trim()
      if (sha) return { ref: candidate, sha }
    } catch {
      // 该候选不存在（本地没建 main、CI 里是浅克隆）——换下一个。
    }
  }
  return null
}

/**
 * 找出 base。返回 `{ base }` 或 `{ error }`。
 * 显式指定的 ref 解析不到一律算错——那说明调用方以为在跟 A 比，实际却没比成；
 * 悄悄换成 main 只会让堆叠 PR 收到一条莫名其妙的「新增了 2 条迁移」。
 */
function resolveBase() {
  const explicit = firstResolvable(explicitBaseCandidates)
  if (explicit) return { base: explicit }
  if (explicitBaseCandidates.length > 0) {
    return { error: `指定的 base 无法解析（试过 ${explicitBaseCandidates.join(', ')}）` }
  }
  const fallback = firstResolvable(fallbackBaseCandidates)
  if (fallback) return { base: fallback }
  return { error: `无可用 base（试过 ${fallbackBaseCandidates.join(', ')}）` }
}

/** base 里某个角色下已有的迁移目录名。 */
function listBaseMigrationFolders(baseSha, role) {
  const prefix = `${migrationRoot}/${role}/`
  let output
  try {
    output = git(['ls-tree', '-r', '--name-only', baseSha, '--', `${migrationRoot}/${role}`])
  } catch {
    return new Set()
  }

  const folders = new Set()
  for (const line of output.split('\n')) {
    if (!line.startsWith(prefix)) continue
    const folder = line.slice(prefix.length).split('/')[0]
    if (folder) folders.add(folder)
  }
  return folders
}

/**
 * 把 `git diff --name-status` 的输出摊平成「文件级」变更。
 * 改名会带两个路径：旧路径算删除、新路径算新增——这正是我们想要的语义
 * （重命名一个已发布的迁移目录，在已有库眼里就是一条新迁移）。
 */
function parseNameStatus(output) {
  const changes = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const fields = line.split('\t')
    const status = fields[0][0]
    if (status === 'R' || status === 'C') {
      changes.push({ status: 'D', file: fields[1] })
      changes.push({ status: 'A', file: fields[2] })
      continue
    }
    changes.push({ status, file: fields[1] })
  }
  return changes
}

/** `packages/core/drizzle/<role>/<folder>/...` → `{ role, folder }`，不在这个形状里就返回 null。 */
function toMigrationFolder(file) {
  const parts = file.split('/')
  if (parts.length < 4 || parts[0] !== 'packages' || parts[1] !== 'core' || parts[2] !== 'drizzle') return null
  const role = parts[3]
  if (!roles.includes(role)) return null
  const folder = parts[4]
  if (!folder) return null
  return { role, folder }
}

function main() {
  log.title('Migration budget check')

  const resolved = resolveBase()
  if (resolved.error) {
    // 没指定 base 时跳过是合理退化（本地浅克隆 / 非 git 目录）；
    // 但「指定了却解析不到」永远算错，CI 里没有 base 更是等于闸门从来没装过。
    const specifiedButMissing = explicitBaseCandidates.length > 0
    const inCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
    if (specifiedButMissing || inCi) {
      log.error(`${resolved.error} —— 迁移额度检查必须对比一个真实的基线分支`)
      process.exit(1)
    }
    log.warn(`${resolved.error} —— 跳过迁移额度检查`)
    return
  }
  const base = resolved.base

  try {
    git(['rev-parse', '--verify', 'HEAD'])
  } catch {
    log.warn('当前目录不是 git 仓库或无法解析 HEAD —— 跳过迁移额度检查')
    return
  }

  const baseFolders = Object.fromEntries(roles.map(role => [role, listBaseMigrationFolders(base.sha, role)]))

  // 对比的是「base 与**工作区**」，不只是 `base..HEAD`：迁移是本地生成、随后才提交的，
  // 要让人在 `pnpm lint` 时就发现超限，而不是等推到 CI。
  const changes = parseNameStatus(git(['diff', '--name-status', '--find-renames', base.sha, '--', migrationRoot]))
  // 未跟踪的文件不在 `git diff` 里，但它们同样是「这次新加的迁移」。
  for (const file of git(['ls-files', '--others', '--exclude-standard', '--', migrationRoot]).split('\n')) {
    if (file.trim()) changes.push({ status: 'A', file: file.trim() })
  }

  const violations = []
  const added = Object.fromEntries(roles.map(role => [role, new Map()]))
  const seenDeletions = new Set()

  for (const change of changes) {
    const target = toMigrationFolder(change.file)
    if (!target) continue
    const { role, folder } = target
    const existedBefore = baseFolders[role].has(folder)
    const folderPath = `${migrationRoot}/${role}/${folder}`

    if (change.status === 'A') {
      // 只统计真正新增的目录：同一次改动里多改几笔这个目录的文件，仍然只算一条。
      if (!existedBefore) added[role].set(folder, folderPath)
      continue
    }

    if (!existedBefore) continue

    if (change.status === 'D') {
      // 一个目录里的两个文件各报一次删除，没有意义。
      if (seenDeletions.has(folderPath)) continue
      seenDeletions.add(folderPath)
      violations.push(`${folderPath}：删除了 ${base.ref} 里已存在的迁移 —— 已发布的迁移只准追加，不准删除`)
    } else {
      violations.push(`${folderPath}：修改了 ${base.ref} 里已存在的迁移 —— 要改结构请追加一条新迁移（重写历史会让 hash 与已执行的 DDL 对不上）`)
    }
  }

  // 两个库合计计数：一条就是一条，不因为「落在不同的库」而多发额度。
  const addedFolders = []
  for (const role of roles) {
    const folders = [...added[role].keys()].sort()
    for (const folder of folders) addedFolders.push(`${role}/${folder}`)
    log.info(`${role}: ${folders.length === 0 ? '无新增迁移' : `新增 ${folders.length} 条（${folders.join('、')}）`}`)
  }

  if (addedFolders.length > maxNewMigrations) {
    violations.push(
      `本次新增了 ${addedFolders.length} 条迁移（${addedFolders.join('、')}）—— 一个 PR 合计只准新增 ${maxNewMigrations} 条`,
    )
  }

  if (violations.length > 0) {
    log.error(`Migration budget check failed（${violations.length} 处）`)
    for (const violation of violations) {
      console.log(`  ${violation}`)
    }
    console.log('')
    console.log(`  口径：对比 ${base.ref}（${base.sha.slice(0, 7)}），整个 PR 合计最多新增 ${maxNewMigrations} 条迁移。`)
    console.log('  跨库改动要动两个库，就拆成两个 PR：先提只含结构的那一半，再在它之上放功能代码。')
    console.log('  同一个库里有多处结构变化，请合并进同一条迁移。')
    process.exit(1)
  }

  log.success(`Migration budget respected（对比 ${base.ref}）`)
}

main()
