import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../toolkit/scripts/lib/log.mjs'

// 控制台的分层约束校验。
//
// 这条规则的核心只有一句：**业务逻辑不认识 React，React 只是渲染层。**
// 写在文档里它只是共识；写成检查它才是约束——顺手在组件里 `await api.xxx()` 不会
// 报错、不会红测试，直到有一天想把同一套逻辑搬到 CLI、托盘或另一个宿主上，才发现
// 它和 `useState` 长在了一起。
//
// 与 `packages/core/scripts/check-proxy-layers.mjs` 同一套做法：静态 import 扫描，
// 新增文件自动纳入，不维护白名单；相对导入先规范化成 `@/` 别名，否则 `../../api/x`
// 一句就绕开了全部规则。
//
// 分层图（散文说明见 `apps/docs/specs/console-architecture.md`）：
//
//   shell / routing / App          组合根：可以认识一切
//   pages/<页面>/components        渲染层：只渲染 props 与 store，不自己发请求
//   pages/<页面>/hooks, store      绑定层：React 与 react-query 可以出现在这里
//   pages/<页面>/lib, source/lib   领域层：零 React，可脱离渲染环境单测
//   source/api                     传输层：只认识 HTTP 与契约
//
// 规则只守**会真的把业务逻辑焊死在渲染层上**的三条边界，不做「谁可以 import 谁」的
// 全序约束：同页 hooks 之间互相依赖、绑定层消费 toast/confirm 这类命令式界面服务，
// 都是正常写法，把它们的顺序也钉死只会产出噪声，换不来可迁移性。

// 脚本住在 `packages/console/scripts`，往上退三层是仓库根。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const consoleRoot = path.join(root, 'packages/console/source')

/** React 运行时（含 JSX 运行时）。 */
const REACT_RUNTIME = /^react(-dom)?(\/|$)/
/** 代表「界面状态」的库：它们出现即意味着这段逻辑挂在渲染周期上。 */
const UI_STATE_LIBS = [
  /^@tanstack\/react(-query|-router|-table|-virtual)?$/,
  /^zustand(\/|$)/,
  /^vaul$/,
  /^@radix-ui\//,
  /^lucide-react$/,
  /^sonner$/,
]

/**
 * 每条规定一批文件「禁止 import 什么」。
 *
 * `paths` 用极简 glob：`*` 匹配一段、`**` 匹配任意段、`{a,b}` 匹配任一。
 */
const RULES = [
  {
    name: 'api',
    summary: '传输层只认识 HTTP 与契约，不认识界面',
    paths: ['api/**'],
    forbid: [
      { pattern: REACT_RUNTIME, why: '传输层不参与渲染，也不得依赖 React 的生命周期' },
      ...UI_STATE_LIBS.map(pattern => ({ pattern, why: '传输层不得依赖界面状态库' })),
      { pattern: /^@\/(components|pages|data|hooks|store|shell|routing)(\/|$)/, why: '传输层不得依赖上层（界面/绑定/组合根）' },
    ],
  },
  {
    name: 'domain',
    summary: '领域层是纯逻辑：零 React、零界面状态库，可脱离渲染环境单测',
    paths: ['lib/**', 'catalog/**', 'platform/**', 'pages/*/lib/**'],
    forbid: [
      // 这条是整个分层的根：核心业务逻辑一旦 import React，就再也搬不走了。
      { pattern: REACT_RUNTIME, why: '领域层不得依赖 React —— 这是本项目分层的核心约束' },
      ...UI_STATE_LIBS.map(pattern => ({
        pattern,
        why: '领域层不得依赖界面状态库；需要可观察状态时用普通类 + 订阅（服务端任务队列即如此：packages/core/source/management/tasks/queue.ts）',
      })),
      { pattern: /^@\/(components|hooks|shell|routing)(\/|$)/, why: '领域层不得依赖上层（界面/绑定/组合根）' },
      { pattern: /^@\/data(\/|$)/, why: '领域层不得依赖 data 绑定层（那里装着 react-query hook）；请把纯函数下沉到 lib' },
    ],
  },
  {
    name: 'view',
    summary: '渲染层只渲染 props 与 store，不自己发请求',
    paths: ['components/**', 'pages/*/components/**'],
    forbid: [
      {
        pattern: /^@\/api(\/|$)/,
        why: '组件不得直连传输层：请求属于绑定层/领域层，组件通过 props 或 hook 拿数据',
        // 只复制类型不产生运行时耦合，允许。
        allowTypeImport: true,
      },
      {
        pattern: /^@tanstack\/react-query$/,
        why: '组件不得自己发起查询；拿数据请走页面 service',
        // `useQueryClient` 只是取缓存句柄（请求日志详情按需取正文），不构成「组件定义查询」。
        allowSpecifiers: ['useQueryClient'],
      },
    ],
  },
]

/**
 * 抽出源码里的每条 import：说明符、是否纯类型导入、整条语句原文。
 *
 * 「纯类型导入」与「带运行时绑定」是两件事：`import type { X } from '@/api/x'` 只在
 * 编译期存在，不把组件绑到传输层上。规则需要这个区分，才能既守住边界又不逼着人复制
 * 一遍类型定义。
 */
function readImports(source) {
  const imports = []
  // 按 `\r?\n` 切：Windows 签出的工作区是 CRLF，残留的 `\r` 会让下面 `(.*)$` 匹配失败
  // （`.` 不匹配行终止符 `\r`），`import type` 就会被误判成运行时导入。
  for (const line of source.split(/\r?\n/)) {
    const dynamic = /(?:^|[^.\w])(?:import|require)\(\s*'([^']+)'\s*\)/.exec(line)
    if (dynamic) {
      imports.push({ specifier: dynamic[1], typeOnly: false, statement: line.trim() })
      continue
    }
    if (!/^\s*(?:import|export)\b/.test(line)) continue
    const specifier = /from\s*'([^']+)'/.exec(line)
    if (!specifier) continue
    const head = /^\s*(?:import|export)\s+(.*)$/.exec(line)?.[1] ?? ''
    imports.push({ specifier: specifier[1], typeOnly: /^type\s/.test(head), statement: line.trim() })
  }
  return imports
}

/** 规范化相对导入，让 `../api/x` 与 `@/api/x` 受同一条规则约束。 */
function canonicalize(specifier, file) {
  if (!specifier.startsWith('.')) return specifier
  const resolved = path.resolve(path.dirname(file), specifier).replaceAll(path.sep, '/')
  const prefix = `${consoleRoot.replaceAll(path.sep, '/')}/`
  return resolved.startsWith(prefix) ? `@/${resolved.slice(prefix.length)}` : specifier
}

/** 极简 glob：`**` 任意段、`*` 一段、`{a,b}` 任一。 */
function matchesPattern(relativePath, pattern) {
  const regex = new RegExp(`^${pattern
    .split('/')
    .map(segment => {
      if (segment === '**') return '.*'
      if (segment === '*') return '[^/]*'
      const brace = /^\{([^}]*)\}$/.exec(segment)
      if (brace) return `(?:${brace[1].split(',').join('|')})`
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')}$`)
  return regex.test(relativePath)
}

/** 该 import 语句里是否只出现了规则放行的具名符号（如 `useQueryClient`）。 */
function allowedBySpecifiers(statement, allowSpecifiers) {
  const named = /\{([^}]*)\}/.exec(statement)
  if (!named) return false
  const symbols = named[1]
    .split(',')
    .map(item => item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter(Boolean)
  return symbols.length > 0 && symbols.every(symbol => allowSpecifiers.includes(symbol))
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
    // 测试文件要搭夹具，可以 import 任意模块；分层约束只作用于源码。
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(target)
  }
  return files
}

async function main() {
  log.title('Console layer check')

  const violations = []
  let checked = 0

  for (const file of await collectSourceFiles(consoleRoot)) {
    const relative = path.relative(consoleRoot, file).replaceAll(path.sep, '/')
    const applicable = RULES.filter(rule => rule.paths.some(pattern => matchesPattern(relative, pattern)))
    if (applicable.length === 0) continue
    checked += 1

    for (const { specifier: raw, typeOnly, statement } of readImports(await readFile(file, 'utf8'))) {
      const specifier = canonicalize(raw, file)
      for (const rule of applicable) {
        for (const item of rule.forbid) {
          if (!item.pattern.test(specifier)) continue
          if (item.allowTypeImport && typeOnly) continue
          if (item.allowSpecifiers && allowedBySpecifiers(statement, item.allowSpecifiers)) continue
          violations.push(`packages/console/source/${relative} → ${specifier}（${rule.name} 层：${item.why}）`)
        }
      }
    }
  }

  for (const rule of RULES) log.info(`${rule.name}: ${rule.summary}`)

  if (violations.length > 0) {
    log.error(`Console layer check failed（${violations.length} 处越界）`)
    for (const violation of violations) console.log(`  ${violation}`)
    process.exit(1)
  }

  log.success(`Console layers respected（${checked} files）`)
}

main()
