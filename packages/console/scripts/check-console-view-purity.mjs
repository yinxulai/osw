import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@typescript-eslint/parser'
import { log } from '../../toolkit/scripts/lib/log.mjs'

// 渲染层的纯度闸门：**领域逻辑不许再长回 `.tsx`**。
//
// `check-console-layers.mjs` 管的是「谁 import 谁」，管不到另一件更常见的事：
// 一段纯逻辑直接写进组件文件。它不违反任何 import 规则——`getTestableProtocols()`
// 就在 `model-test-panel.tsx` 里算了三年，只有想把它搬到 CLI 或托盘上时才暴露出来。
// 那种逻辑有个共同特征：它是**模块作用域的纯函数**，不返回 JSX、不调 hook，
// 却和一个具体页面绑死。这条闸门就守这个特征。
//
// 两条规则：
// 1. `.tsx` 不得有模块作用域的 `let` / `var`。可变的模块级状态等于一个没订阅机制的
//    外部 store：改它不会触发渲染，测它要先 import 一个组件文件。
// 2. 每个 `.tsx` 的「视图逻辑单元」数量不得超过 `view-logic-budget.json` 里记的数。
//    逻辑单元 = 模块作用域的普通函数（名字小写、不是 `useXxx` hook），也就是
//    `getXxx` / `toXxx` / `formatXxx` / `handleXxx` 这一类。
//
// 为什么第 2 条是账本而不是「一律为 0」：现存的 60 来个一行格式化函数是历史，
// 一次全搬是无关重构，也让这条规则在落地当天就红。账本把现状记下来，**只准降不准升**；
// 新文件从 0 起算，于是「往组件里再塞一个纯函数」这件事第一次变成了会失败的操作。
// 要加逻辑，就去 `lib/`（或页面自己的 `lib/`）加，并顺手给它写个不渲染 React 的单测。
//
// 与 `check-proxy-layers.mjs` 同一套做法：脚本住在被检查的包里，改界面的人自己就能跑；
// 挂在 `pnpm lint` 与 `pnpm lint:layers` 上，靠既有命令自动生效，不需要谁记得单独执行。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const consoleRoot = path.join(root, 'packages/console/source')
const budgetFile = path.join(root, 'packages/console/scripts/view-logic-budget.json')

/** 组件是 PascalCase，hook 是 `use` + 大写；其余模块作用域函数都算「逻辑单元」。 */
function classify(name) {
  if (/^[A-Z]/.test(name)) return 'component'
  if (/^use[A-Z]/.test(name)) return 'hook'
  return 'logic'
}

/** 从 AST 里取出模块作用域的函数声明与可变绑定。 */
function readModuleScope(program) {
  const logic = []
  const mutable = []
  for (const statement of program.body) {
    if (statement.type === 'FunctionDeclaration') {
      const name = statement.id?.name
      if (name && classify(name) === 'logic') logic.push(name)
      continue
    }
    if (statement.type !== 'VariableDeclaration') continue
    for (const declarator of statement.declarations) {
      if (declarator.id.type !== 'Identifier') continue
      const name = declarator.id.name
      if (statement.kind !== 'const') {
        mutable.push(name)
        continue
      }
      const init = declarator.init
      if (!init) continue
      if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') continue
      if (classify(name) === 'logic') logic.push(name)
    }
  }
  return { logic, mutable }
}

async function collectViewFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectViewFiles(target)))
      continue
    }
    // 组件单测要搭夹具、要就地造数据，不受这条规则约束；它测的正是源码文件。
    if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(target)
  }
  return files
}

async function main() {
  log.title('Console view purity')

  const parsed = JSON.parse(await readFile(budgetFile, 'utf8'))
  // `$comment` 这类说明性键不是文件名。
  const budget = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('$')))
  const violations = []
  const tighten = []
  const seen = new Set()
  let checked = 0
  let units = 0

  for (const file of await collectViewFiles(consoleRoot)) {
    const relative = path.relative(consoleRoot, file).replaceAll(path.sep, '/')
    seen.add(relative)
    checked += 1

    const { logic, mutable } = readModuleScope(parse(await readFile(file, 'utf8'), {
      ecmaVersion: 'latest',
      sourceType: 'module',
      jsx: true,
      loc: false,
      range: false,
    }))
    units += logic.length

    for (const name of mutable) {
      violations.push(`packages/console/source/${relative} → 模块作用域的可变绑定 \`${name}\`（视图层不得自己持有可变状态）`)
    }

    // 新文件没有账本条目，按 0 算：从第一天起就不许往里写纯逻辑。
    const allowed = budget[relative] ?? 0
    if (logic.length > allowed) {
      const added = logic.length - allowed
      violations.push(
        `packages/console/source/${relative} → 视图逻辑单元 ${logic.length} 个，超出预算 ${allowed} 个（新增 ${added}）：`
        + `${logic.map(name => `\`${name}\``).join('、')}。纯逻辑请移到 \`lib/\` 或页面自己的 \`lib/\`，并补一个不渲染 React 的单测。`,
      )
    }
    if (logic.length < allowed) tighten.push(`${relative}: ${allowed} → ${logic.length}`)
  }

  const stale = Object.keys(budget).filter(file => !seen.has(file))

  log.info(`检查 ${checked} 个 .tsx，模块作用域逻辑单元 ${units} 个`)
  log.info('规则：视图文件不得持有模块级可变状态；逻辑单元只准降不准升（新文件从 0 起算）')

  if (violations.length > 0) {
    log.error(`Console view purity failed（${violations.length} 处越界）`)
    for (const violation of violations) console.log(`  ${violation}`)
    process.exit(1)
  }

  if (stale.length > 0) {
    log.error(`预算里有 ${stale.length} 个已不存在的文件，请删掉这些条目`)
    for (const file of stale) console.log(`  ${file}`)
    process.exit(1)
  }

  if (tighten.length > 0) {
    log.info(`以下文件的预算可以收紧（当前更低，条目未更新）：${tighten.join('；')}`)
  }

  log.success(`Console view purity respected（${checked} files）`)
}

main()
