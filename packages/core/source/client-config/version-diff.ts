import type { ClientConfigVersionDiff } from '@common/client-config'

/**
 * 版本摘要最多列几处差异。
 *
 * 界面每行只摆得下两三处，列更多也没人看；这里截断只是不让一份「整段被重排过」的文件
 * 在内存里摊出一长串没人读的数组。数量足够大，正常改动（改几个模型名）都能一览无余。
 */
const MAX_DIFFS = 12

/** 一份配置里的「键路径 → 值」，值已经化成能直接读的短文本。 */
type FlatEntries = [key: string, value: string][]

/**
 * 两份内容之间「值得看」的差异。
 *
 * 能当 JSON 读的就**按键比**（`env.ANTHROPIC_MODEL` 从什么变成什么），读不了再退回按行比。
 * 多数客户端配置文件是 JSON，而且 `JSON.stringify` 写出来常常就是**一整行**——
 * 在那种文件上按行比等于把整份文件当成一行，两版都是同一根长字符串，截断后看着还一模一样。
 * 按键比就不受缩进、换行、键序影响，说出来的也正好是人想知道的「哪个值变成了什么」。
 */
export function diffClientConfigContent(current: string, version: string): ClientConfigVersionDiff[] {
  const before = flattenJson(current)
  const after = flattenJson(version)
  if (before === null || after === null) return diffClientConfigLines(current, version)
  return diffClientConfigEntries(before, after)
}

/**
 * 把 JSON 摊成键路径到值的清单，按原文档顺序。
 *
 * 递归到底：`env: {...}` 这种中间层不算一处内容，只有叶子（和整个数组）才是值。
 * 内容不是 JSON、或者根本不是对象（空的、半截的）时返回 null，由调用方改走行比较。
 */
function flattenJson(content: string): FlatEntries | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const entries: FlatEntries = []
  collectEntries(parsed, '', entries)
  return entries
}

function collectEntries(value: unknown, prefix: string, entries: FlatEntries): void {
  if (value === null || typeof value !== 'object') {
    entries.push([prefix, formatValue(value)])
    return
  }
  // 数组作为一个整体：逐项展开只会把 `permissions.allow.0`、`.1` 铺成一片没人看的噪音。
  if (Array.isArray(value)) {
    entries.push([prefix, JSON.stringify(value)])
    return
  }
  for (const [key, child] of Object.entries(value)) {
    collectEntries(child, prefix === '' ? key : `${prefix}.${key}`, entries)
  }
}

/** 字符串直接给出裸值（`ANTHROPIC_MODEL: default` 比带引号好读），其余按 JSON 写法。 */
function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** 两侧的键合起来看：改了的、只在当前有的、只在这一版有的。 */
function diffClientConfigEntries(before: FlatEntries, after: FlatEntries): ClientConfigVersionDiff[] {
  const remaining = new Map(after)
  const diffs: ClientConfigVersionDiff[] = []
  for (const [key, value] of before) {
    if (!remaining.has(key)) {
      diffs.push({ before: `${key}: ${value}`, after: null })
      continue
    }
    const next = remaining.get(key) ?? ''
    if (next !== value) diffs.push({ before: `${key}: ${value}`, after: `${key}: ${next}` })
    remaining.delete(key)
  }
  // 剩下的是这一版新加的键；在文档里的位置已经无从谈起，统一排在末尾。
  for (const [key, value] of remaining) diffs.push({ before: null, after: `${key}: ${value}` })
  return diffs.slice(0, MAX_DIFFS)
}

/**
 * 只由结构符号组成的行：`{`、`}`、`[`、`]`、`,` 这些。
 *
 * 它们在任何两版之间都可能不同，却什么也没说明——版本列表从前按内容开头截断，
 * 于是每一行都显示一个 `{`，问题就出在这里。比较时先滤掉它们。
 */
const STRUCTURAL_LINE = /^[{}[\](),;]+$/

/** 内容里「说了点什么」的行，去掉首尾空白与行尾逗号后按原顺序排列。 */
function meaningfulLines(content: string): string[] {
  return content
    .split('\n')
    .map(line => normalizeLine(line))
    .filter(line => line !== '' && !STRUCTURAL_LINE.test(line))
}

/**
 * 参与比较、也参与展示的行形态。
 *
 * 尾逗号是 JSON 的语法而不是内容：`"model": "x"` 与 `"model": "x",` 是同一行，
 * 多一个逗号不算「改动」，展示时也少两个字符——菜单只有 320px 宽。
 */
function normalizeLine(line: string): string {
  return line.trim().replace(/,$/, '').trim()
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

/**
 * 读不成 JSON 时的后备：按行比。
 *
 * 不用通用 LCS：改动几乎都是「某几行的值变了」，按**行的多重集**比较就能又快又准地
 * 说出这件事，而多余的重排不会把结果搅乱成一片。逐行取差得到两组行——当前有而这一版没有的、
 * 这一版有而当前没有的——再按位置配对成「这一处从 A 变成了 B」。
 *
 * 配对的前提是两边大体同序：改一个模型名，两边各多出同一位置的一行，配出来正好是那一处变化。
 * 数量对不齐时（一行被拆成两行之类）也不会丢信息，只是多出一对「只有 before」或「只有 after」。
 */
export function diffClientConfigLines(current: string, version: string): ClientConfigVersionDiff[] {
  const beforeLines = meaningfulLines(current)
  const afterLines = meaningfulLines(version)
  if (beforeLines.length === 0 && afterLines.length === 0) return []

  // 两边都有的行不算差异；多出来的那些分别是「回退会去掉的」与「回退会加上的」。
  const afterCounts = countLines(afterLines)
  const removed: string[] = []
  for (const line of beforeLines) {
    const left = afterCounts.get(line) ?? 0
    if (left > 0) afterCounts.set(line, left - 1)
    else removed.push(line)
  }

  const beforeCounts = countLines(beforeLines)
  const added: string[] = []
  for (const line of afterLines) {
    const left = beforeCounts.get(line) ?? 0
    if (left > 0) beforeCounts.set(line, left - 1)
    else added.push(line)
  }

  const diffs: ClientConfigVersionDiff[] = []
  const size = Math.max(removed.length, added.length)
  for (let index = 0; index < size && diffs.length < MAX_DIFFS; index += 1) {
    diffs.push({ before: removed[index] ?? null, after: added[index] ?? null })
  }
  return diffs
}
