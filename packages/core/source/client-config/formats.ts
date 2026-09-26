import type { ClientConfigFormat } from '@common/client-config'

/**
 * 按格式读写配置文件里的**单个键**，而不是「读成对象再整体重写」。
 *
 * 为什么值得这么麻烦：这些文件是用户自己的配置文件，里面还有与本功能无关的东西
 * （Claude Code 的 `permissions`、Codex 的 sandbox 设置……）。整体 parse → 修改 → 序列化
 * 会顺手把注释、缩进风格、键顺序全部重排一遍，diff 里塞满噪音，用户下次 review 自己的
 * 配置时会不知道哪一行是自己改的。所以这四种格式都**只动目标键所在的那一处**：
 *
 *   - JSON 在原对象上原地读，改动落到**文本层**——命中已有键就替换那个值的字符区间，
 *     没有这个键就按原文自己的缩进风格插一行（见 `JsonConfigEditor`）；
 *   - TOML 是纯行操作，未触及的行原样保留（注释也在内）；
 *   - `.env` 只替换命中的那一行。
 *
 * 写入**只动目标值占的那几个字符**，连形状也跟着原文：原来写在一行的小对象，写回去
 * 仍在一行。这条规则不是为好看——一键生效会被算两遍（预览 + 落盘），如果第一次写入
 * 改变了文件风格，第二次就会觉得「风格不对、得再改一次」，于是每点一下按钮就多出一份
 * 内容相同但排版不同的历史。
 *
 * 读不出来（语法坏了）时抛 `ConfigParseError`，由调用方翻成 `CLIENT_CONFIG_PARSE_FAILED`
 * ——**不猜、不修、不覆盖**：文件已经坏了的时候，最不该做的就是再往里写点什么。
 */

export class ConfigParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigParseError'
  }
}

/**
 * 可以写进配置的标量。
 *
 * 布尔值必须是真的布尔而不是字串：JSON 里 `"true"` 与 `true` 是两回事，写错了客户端会把
 * 字符串当成 truthy 从而行为完全不对。`.env` 与 TOML 那边没有布尔类型，由各自的编辑器降级成文本。
 */
export type ConfigScalar = string | number | boolean

/**
 * 一个配置文件编辑器。
 *
 * 路径都是点号分隔的键路径（注册表 `fields[].path` 的形态）。`get` 只认标量：
 * 读到对象/数组时返回 `null`（那是「这里不是个值」，不是「值是空」）。
 */
export interface ConfigEditor {
  /** 读标量；不存在或不是标量时返回 `null`。 */
  get(path: string): string | null
  /**
   * 写标量，返回**它被改写之前**的值（原本没有这个键时是 `null`）。
   *
   * 回传「改前」是给版本摘要用的：那一步要告诉用户「`wire_api` 从 `chat` 变成
   * `responses`」，而调用方在 `set` 之后再 `get` 到的只会是新值。让编辑器顺手把旧值带出来，
   * 比调用方自己记得「先读一遍」可靠——忘了读只会得到一个空白的前后对比。
   */
  set(path: string, value: ConfigScalar): string | null
  /**
   * 写一个对象（如 provider 表项），返回它被改写之前的**整段文本**（原本没有时是 `null`）。
   *
   * 值允许嵌套（JSON 的 provider 表项里就有 `options`），但 TOML 与 `.env` 都只有一层，
   * 遇到嵌套会明确报错而不是写出一份语法坏掉的文件。
   */
  setObject(path: string, value: Record<string, unknown>): string | null
  /** 序列化回文件文本。 */
  serialize(): string
}

export function createConfigEditor(format: ClientConfigFormat, text: string): ConfigEditor {
  switch (format) {
    case 'json':
    case 'jsonc':
      return new JsonConfigEditor(text)
    case 'env':
      return new EnvConfigEditor(text)
    case 'toml':
      return new TomlConfigEditor(text)
    case 'yaml':
      throw new ConfigParseError('yaml autofill is not supported')
  }
}

/** 支持自动填充的格式。`yaml` 没有结构化写入器（见 `docs/product/` 里的取舍说明）。 */
export function supportsAutoFill(format: ClientConfigFormat): boolean {
  return format === 'json' || format === 'jsonc' || format === 'env' || format === 'toml'
}

// ========== JSON / JSONC ==========

/** 原文看不出缩进风格时用的单位，与 `JSON.stringify` 的默认一致。 */
const DEFAULT_JSON_INDENT = '  '

/** 一段值的字符区间（`start` 含、`end` 不含），以及它是不是一个对象。 */
interface JsonValueSpan {
  start: number
  end: number
  object: boolean
}

/** 一个容器（对象）在原文里的位置：从哪儿开始、缩在第几层。 */
interface JsonContainer {
  start: number
  depth: number
}

/**
 * JSON 编辑器：**用解析结果读，用文本操作写**。
 *
 * 为什么不像以前那样把对象 `String` 化回去：`JSON.stringify(data, null, 2)` 只保证「值还在」，
 * 不保证「文件还是用户写的那一份」——它会把 4 空格或 Tab 压成 2 空格、吃掉空行与行尾空白、
 * 把末尾换行统一成一个。对一份别人（或者别的工具）也在编辑的 `settings.json` 来说，
 * 那就是改一个键留下一整份 diff。
 *
 * 所以这里分成两件事：
 *
 *   - **读**（`get`）走 `JSON.parse` 出来的对象，与格式细节无关；
 *   - **写**（`set` / `setObject`）走文本：命中已有的键就替换那个值占的字符区间，
 *     没有这个键才插入——插入按**原文自己的缩进单位**，不套死两空格。
 *
 * 每次改完都回读校验一次（`verify`）——把结果重新解析，与「我们以为的文档」比一遍。
 * 这一层是文本替换的保险丝：扫描器万一在某个没见过的写法上算错了区间，结果会是一份
 * 「语法合法但内容不对」的文件，那是查起来最贵的一类问题。校验不过就抛错，一个字节都不落盘。
 *
 * 缩进与形状一律**按路径算**，不从相邻行或局部片段猜：路径深度决定级别，原文第一处缩进
 * 决定单位，值自己原来是单行就写单行。跟着局部走的话，我们上一次写进去的排版会变成
 * 下一次的「原文风格」。
 *
 * `jsonc` 与 `json` 共用这一层。带注释的文件仍然在构造时被 `JSON.parse` 判为「解析不了」
 * （放宽它是另一件事，需要另一套提交保护，不在这里顺手做）；能读进来的文件，改一个键
 * 就只动那一个值。
 */
class JsonConfigEditor implements ConfigEditor {
  /** 原文。改动只在这份文本上做局部替换，`serialize()` 交出去的就是它。 */
  private text: string
  /** 只用于读取与形状判断。序列化不走这里——走了就退化成整文件重排。 */
  private data: Record<string, unknown>

  constructor(text: string) {
    this.text = text
    if (text.trim() === '') {
      this.data = {}
      return
    }
    let parsed: unknown
    try {
      // `jsonc` 走的是同一条路：JSON.parse 认不下注释时按「解析失败」处理，
      // 而不是去猜注释——猜错一次就是往用户配置里写坏结构。
      parsed = JSON.parse(text)
    } catch (error) {
      throw new ConfigParseError(error instanceof Error ? error.message : 'invalid JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConfigParseError('root value must be an object')
    }
    this.data = parsed as Record<string, unknown>
  }

  get(path: string): string | null {
    const found = getInObject(this.data, splitPath(path))
    if (found === undefined || found === null || typeof found === 'object') return null
    return String(found)
  }

  set(path: string, value: ConfigScalar): string | null {
    const segments = splitPath(path)
    if (segments.length === 0) return null
    const before = this.get(path)
    this.text = this.writeScalar(segments, value)
    setInObject(this.data, segments, value)
    this.verify()
    return before
  }

  /**
   * 整段写一个对象。
   *
   * 返回**命中已有键时**它在原文里的样子（调用方拿它当「改前」）；新插入时返回 `null`。
   * 两者都不是唯一信号：写入之后还可能被 `verify` 拦下，那时抛错，「上次写的是什么」
   * 这个问题已经没有意义了。
   */
  setObject(path: string, value: Record<string, unknown>): string | null {
    const segments = splitPath(path)
    if (segments.length === 0) return null
    const entry = { ...value }
    const before = this.rawValue(segments)
    // 在文本里写之前先动对象：值里有没有 `undefined`（会把自己序列化没）、数组里有没有空洞，
    // 只有序列化一次才知道。改完对象再改文本，两者才可能严格一致——否则 `verify` 会拦下
    // 一份「文本合法、但不是我们想写的东西」的文件，而那是我们自己的 bug，不该报给用户。
    setInObject(this.data, segments, entry)
    this.text = this.writeObject(segments, entry)
    this.verify()
    return before
  }

  serialize(): string {
    // 没有原文可保（空文件、只有空白）时给一份最小的空对象：界面下次的写入就基于它，
    // 不会因为「什么都没有」而永远写不进去。
    return this.text.trim() === '' ? '{}\n' : this.text
  }

  private writeScalar(segments: string[], value: ConfigScalar): string {
    const span = this.valueSpan(segments)
    if (span !== null) return spliceText(this.text, span.start, span.end, JSON.stringify(value))

    const container = this.containerOf(segments)
    if (container === null) return this.writeMissingChain(segments, value)
    return this.addMember(container, segments[segments.length - 1]!, value)
  }

  private writeObject(segments: string[], value: Record<string, unknown>): string {
    const span = this.valueSpan(segments)
    if (span !== null) {
      // 续行缩到**这个值自己的第一层**（`segments.length`），而不是它现在所在那一行的空白：
      // 用户若在对象中间换了一行再接下去写，跟着行首缩进会把整块往下多推一层。
      const indent = this.indentFor(segments.length)
      const compact = !this.text.slice(span.start, span.end).includes('\n')
      return spliceText(this.text, span.start, span.end, this.renderValue(value, compact, indent))
    }
    const container = this.containerOf(segments)
    if (container === null) return this.writeMissingChain(segments, value)
    return this.addMember(container, segments[segments.length - 1]!, value)
  }

  /**
   * 中间层还不存在：把「从这一层到根」的整条链一次补出来。
   *
   * 只有文件本身是空的时才由我们生成整份文档；否则在根对象里插一个成员，链上的对象一并带上
   * （`{ "env": { "ANTHROPIC_BASE_URL": "…" } }`）——一次插入换一次校验，中间不留半成品。
   */
  private writeMissingChain(segments: string[], value: unknown): string {
    const root = this.rootStart()
    const unit = this.indentUnit()
    if (root === null) return `${JSON.stringify(buildJsonChain(segments, value), null, unit)}\n`
    const nested = buildJsonChain(segments.slice(1), value)
    return this.addMember({ start: root, depth: 0 }, segments[0]!, nested)
  }

  /** 该路径上原文里的那一段（键不存在时是 `null`）。版本摘要要的「改前」就取它。 */
  private rawValue(segments: string[]): string | null {
    const span = this.valueSpan(segments)
    return span === null ? null : this.text.slice(span.start, span.end)
  }

  /**
   * 路径对应的**值**区间。
   *
   * 返回 `null` 只表示「这条路径上的某个键不存在」；路径上有一层不是对象时**抛错**——
   * 那说明用户在这个位置放了自己的值（`"env": "https://…"` 之类），我们既不能把它当成
   * 可以随便盖掉的垫脚石，也不能假装没看见而写一个重名键进去。
   */
  private valueSpan(segments: string[]): JsonValueSpan | null {
    const root = this.rootStart()
    if (root === null) return null
    let container = root
    let found: JsonValueSpan | null = null
    for (let index = 0; index < segments.length; index += 1) {
      const member = findJsonMember(this.text, container, segments[index]!)
      if (member === null) return null
      if (index < segments.length - 1 && member.object !== true) {
        throw new ConfigParseError(`"${segments.slice(0, index + 1).join('.')}" is not an object`)
      }
      found = member
      container = member.start
    }
    return found
  }

  /**
   * 承载最后一个键的那个对象：开在原文的什么位置、缩到第几层。中间层不存在时返回 `null`。
   *
   * 插入点与缩进必须是同一份判断得出的结果，所以一起交回去——分两处各算一遍迟早会错开。
   */
  private containerOf(segments: string[]): JsonContainer | null {
    if (segments.length === 1) {
      const start = this.rootStart()
      return start === null ? null : { start, depth: 0 }
    }
    const parent = segments.slice(0, -1)
    const span = this.valueSpan(parent)
    if (span === null) return null
    if (span.object !== true) throw new ConfigParseError(`"${parent.join('.')}" is not an object`)
    return { start: span.start, depth: parent.length }
  }

  /** 根对象的 `{` 在哪（空文件或只有空白时是 `null`）。 */
  private rootStart(): number | null {
    const start = skipJsonSpace(this.text, 0)
    return this.text[start] === '{' ? start : null
  }

  /**
   * 在某个对象里加一个成员，返回新的完整文本。
   *
   * 成员的写成什么形状由**整个文件**决定，而不是由这个对象自己现在长什么样：
   * 一行到底的文件里插一行到底的成员，多行文件里插一个多行成员。只看局部的话，
   * 我们第一次写进去的换行会成为第二次读到的「原文风格」，结果每写一次就重排一次。
   *
   * 插入点分三种：空表贴着 `{` 写、单行表接在最后一个成员后面、多行表另起一行。逗号补在
   * **最后一个成员之后**而不是 `}` 之前——`}` 与最后一个成员之间的空白与内容留在原地，
   * 那些不是我们的东西。
   */
  private addMember(container: JsonContainer, key: string, value: unknown): string {
    const bounds = jsonObjectBounds(this.text, container.start)
    const compact = !this.text.includes('\n')
    const memberIndent = this.indentFor(container.depth + 1)
    const rendered = this.renderValue(value, compact, memberIndent)
    const member = compact ? `${JSON.stringify(key)}:${rendered}` : `${JSON.stringify(key)}: ${rendered}`
    // 从 `}` 的**前一格**开始往回找：不能让收尾的括号自己被当成「最后一个成员」。
    const tail = lastMeaningfulIndex(this.text, bounds.end - 1)

    if (tail < bounds.start + 1) {
      if (compact) return spliceText(this.text, bounds.start + 1, bounds.start + 1, member)
      // 空表里插一个多行成员，收尾的 `}` 也挪到自己那一行，不贴着成员的末尾。
      const insertion = `\n${memberIndent}${member}`
      const withMember = spliceText(this.text, bounds.start + 1, bounds.start + 1, insertion)
      const closing = bounds.end - 1 + insertion.length
      return spliceText(withMember, closing, closing, `\n${this.indentFor(container.depth)}`)
    }

    const comma = this.text[tail] === ',' ? '' : ','
    const inserted = compact ? `${comma}${member}` : `${comma}\n${memberIndent}${member}`
    return spliceText(this.text, tail + 1, tail + 1, inserted)
  }

  /**
   * 一个值写进原文时的样子。
   *
   * `compact` 表示**它原来就写在一行**（或整份文件只有一行）：那时不能把它抻成多行，
   * 而多行时续行的缩进以「这个成员自己所在的层」为基准（见 `indentBlock`）。
   */
  private renderValue(value: unknown, compact: boolean, memberIndent: string): string {
    if (compact) return JSON.stringify(value)
    return indentBlock(JSON.stringify(value, null, this.indentUnit()), memberIndent)
  }

  /** 某个深度上的空白前缀。深度由路径给出，与文件里已经有多少层空白无关。 */
  private indentFor(depth: number): string {
    return this.indentUnit().repeat(Math.max(0, depth))
  }

  /**
   * 原文用的缩进单位。
   *
   * 只看**第一处缩进**，不做多数派统计：一份手写的 JSON 前面用 Tab、后面用空格是完全可能的，
   * 而多行文件的第一处缩进就是第一层，正是我们要的那个单位。看不出来时用两空格。
   */
  private indentUnit(): string {
    const whitespace = /\n([ \t]+)\S/.exec(this.text)?.[1]
    if (!whitespace) return DEFAULT_JSON_INDENT
    return whitespace.startsWith('\t') ? '\t' : whitespace
  }

  /** 见类注释：改完之后重新解析一次，确认结果确实是我们以为的那份文档。 */
  private verify(): void {
    if (this.text.trim() === '') return
    let reparsed: unknown
    try {
      reparsed = JSON.parse(this.text)
    } catch (error) {
      throw new ConfigParseError(`refusing to write malformed JSON: ${error instanceof Error ? error.message : 'parse failed'}`)
    }
    if (JSON.stringify(reparsed) !== JSON.stringify(this.data)) {
      throw new ConfigParseError('refusing to write JSON that does not match the intended change')
    }
  }
}

function splitPath(path: string): string[] {
  return path.split('.').filter(segment => segment.length > 0)
}

function getInObject(target: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = target
  for (const segment of segments) {
    // `<id>` 是「运行期才知道的一段」：读的时候没有具体 id，只能当读不到。
    if (segment.startsWith('<') || current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setInObject(target: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) return
  let current = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!
    const next = current[segment]
    if (next === undefined) {
      current[segment] = {}
    } else if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      // 与 `valueSpan` 里的同一道闸：中间层是用户自己的值，不能当垫脚石。
      throw new ConfigParseError(`"${segment}" is not an object`)
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]!] = value
}

/** 把 `['env','A'] + v` 折成 `{ env: { A: v } }`。 */
function buildJsonChain(segments: string[], value: unknown): unknown {
  let current: unknown = value
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    current = { [segments[index]!]: current }
  }
  return current
}

/**
 * 在一个对象里找 `key` 对应的成员；键不存在时返回 `null`。
 *
 * 只做**扫描**不解析：JSON 的字符串字面量里可以出现 `}`、`:`、`,`，正则或者
 * 「找下一个 `:`」这种写法在那些值上会算错位置，而算错位置的结果是往用户配置里写坏内容。
 * 所以这里老老实实跳过字符串、按括号配对走。
 */
function findJsonMember(text: string, containerStart: number, key: string): JsonValueSpan | null {
  const container = jsonObjectBounds(text, containerStart)
  // 成员只可能落在 `{` 与 `}` 之间（`end` 是 `}` 之后的那一格）。
  let index = skipJsonSpace(text, containerStart + 1)
  while (index < container.end - 1) {
    const step = readJsonMember(text, index, container.end, key)
    if (step.member !== null) return step.member
    // 没有往前推进就说明这段文本不是我们以为的形状：宁可拒绝写，也不要原地打转。
    if (step.end <= index) throw new ConfigParseError(`cannot scan the object at offset ${containerStart}`)
    index = skipJsonSpace(text, step.end)
  }
  return null
}

/** 从 `index` 读一个成员（或一个裸值），返回它的结束位置，以及命中 `key` 时的值区间。 */
function readJsonMember(text: string, index: number, limit: number, key: string): { end: number; member: JsonValueSpan | null } {
  const character = text[index]
  if (character === ',') return { end: index + 1, member: null }
  if (character !== '"') return { end: jsonValueBounds(text, index).end, member: null }

  const nameEnd = jsonStringEnd(text, index)
  if (nameEnd === null) throw new ConfigParseError(`unterminated key at offset ${index}`)
  const colon = skipJsonSpace(text, nameEnd)
  if (text[colon] !== ':') throw new ConfigParseError(`expected ":" after the key at offset ${nameEnd}`)
  const value = jsonValueBounds(text, skipJsonSpace(text, colon + 1))
  if (value.end > limit) throw new ConfigParseError(`the value at offset ${value.start} runs past its object`)
  // 键名本身可能带转义（`"a\u0062"`）：比之前还原一次，否则会与 `get` 给出的值对不上。
  return { end: value.end, member: decodeJsonString(text.slice(index, nameEnd)) === key ? value : null }
}

/** 一段值的区间。字符串与括号结构按各自的配对走，其余读到一个分隔符为止。 */
function jsonValueBounds(text: string, start: number): JsonValueSpan {
  const character = text[start]
  if (character === '{' || character === '[') {
    const end = jsonBracketEnd(text, start)
    if (end === null) throw new ConfigParseError(`unterminated value at offset ${start}`)
    return { start, end, object: character === '{' }
  }
  if (character === '"') {
    const end = jsonStringEnd(text, start)
    if (end === null) throw new ConfigParseError(`unterminated string at offset ${start}`)
    return { start, end, object: false }
  }
  let end = start
  while (end < text.length && !isJsonValueTerminator(text[end]!)) end += 1
  // 值后面的空白留给原文：替换时把它交还回去，行尾不会被我们剪掉。
  while (end > start && isJsonSpace(text[end - 1]!)) end -= 1
  return { start, end, object: false }
}

/** 一个对象所占的区间；`start` 上不是 `{`、或者括号配不上时抛错。 */
function jsonObjectBounds(text: string, start: number): { start: number; end: number } {
  if (text[start] !== '{') throw new ConfigParseError(`expected an object at offset ${start}`)
  const end = jsonBracketEnd(text, start)
  if (end === null) throw new ConfigParseError(`unterminated object at offset ${start}`)
  return { start, end }
}

/** `start` 上那个 `{` / `[` 配对符号**之后**的位置；配不上时返回 `null`。 */
function jsonBracketEnd(text: string, start: number): number | null {
  const open = text[start]
  if (open !== '{' && open !== '[') return null
  let depth = 0
  let index = start
  while (index < text.length) {
    const character = text[index]!
    if (character === '"') {
      const end = jsonStringEnd(text, index)
      if (end === null) return null
      index = end
      continue
    }
    if (character === '{' || character === '[') depth += 1
    if (character === '}' || character === ']') {
      depth -= 1
      if (depth === 0) return index + 1
    }
    index += 1
  }
  return null
}

/** `start` 上那个 `"` 之后的位置；字符串没有收尾时返回 `null`。 */
function jsonStringEnd(text: string, start: number): number | null {
  let index = start + 1
  while (index < text.length) {
    const character = text[index]!
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '"') return index + 1
    index += 1
  }
  return null
}

/** 键名字面量 → 真正的字符串。没有转义时不做那一次 `JSON.parse`。 */
function decodeJsonString(literal: string): string {
  const body = literal.slice(1, -1)
  if (!body.includes('\\')) return body
  try {
    return JSON.parse(literal) as string
  } catch {
    throw new ConfigParseError(`unreadable key ${literal}`)
  }
}

/** 把一段多行 JSON 挂到 `indent` 这一层：首行留在调用方给的位置，其余行整体前移。 */
function indentBlock(rendered: string, indent: string): string {
  if (!rendered.includes('\n')) return rendered
  return rendered
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join('\n')
}

function spliceText(text: string, start: number, end: number, replacement: string): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`
}

/** `end` 之前最后一个非空白字符的位置；前面全是空白时返回 `-1`。 */
function lastMeaningfulIndex(text: string, end: number): number {
  let index = end - 1
  while (index >= 0 && isJsonSpace(text[index]!)) index -= 1
  return index
}

function skipJsonSpace(text: string, start: number): number {
  let index = start
  while (index < text.length && isJsonSpace(text[index]!)) index += 1
  return index
}

function isJsonSpace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

function isJsonValueTerminator(character: string): boolean {
  return character === ',' || character === '}' || character === ']'
}

// ========== .env ==========

/**
 * `KEY=VALUE` 行编辑。
 *
 * 只认最简单的形态：允许 `export ` 前缀、允许 `#` 注释行、允许值被单双引号包着。
 * 多行值、变量插值这些一律**原样保留不动**——我们只替换命中的那一行。
 */
class EnvConfigEditor implements ConfigEditor {
  private lines: string[]
  /** 本次编辑是否已经追加过新键——决定还要不要为新块补那个分隔空行。 */
  private appended = false

  constructor(text: string) {
    if (text.trim() === '') {
      this.lines = []
      return
    }
    this.lines = text.split('\n')
    if (text.endsWith('\n')) this.lines.pop()
  }

  get(path: string): string | null {
    const index = this.findLineIndex(path)
    if (index < 0) return null
    return parseEnvValue(this.lines[index]!)
  }

  set(path: string, value: ConfigScalar): string | null {
    const line = `${path}=${formatEnvValue(typeof value === 'string' ? value : String(value))}`
    const index = this.findLineIndex(path)
    if (index >= 0) {
      const before = parseEnvValue(this.lines[index]!)
      this.lines[index] = line
      return before
    }
    // 追加在末尾；与原有内容之间留一个空行，但同一批追加出来的键之间不插空行。
    if (!this.appended && this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('')
    this.lines.push(line)
    this.appended = true
    return null
  }

  setObject(): null {
    throw new ConfigParseError('.env files cannot hold nested objects')
  }

  serialize(): string {
    return `${this.lines.join('\n')}\n`
  }

  private findLineIndex(key: string): number {
    return this.lines.findIndex((line) => {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
      return match?.[1] === key
    })
  }
}

function parseEnvValue(line: string): string {
  const raw = line.slice(line.indexOf('=') + 1).trim()
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1)
  }
  return raw
}

function formatEnvValue(value: string): string {
  if (value === '' || /[\s#'"$]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

// ========== TOML（行级最小实现） ==========

/**
 * 只认「`[section]` 表头 + `key = value` 标量」这一层的最小 TOML 编辑器。
 *
 * 刻意不引入 TOML 库：我们真正要写的只有 Codex 的几个键（`model`、`model_provider`，
 * 以及一张 `[model_providers.osw]` 表），而这些键在我们支持的文件里都是这一层的标量/表。
 * 行级的做法换来一个更有用的性质——**未触及的行一字不动**，包括注释、空行与缩进。
 * 代价是：数组、内联表、多行字符串这些形态我们不写也不动它们。
 */
class TomlConfigEditor implements ConfigEditor {
  private lines: string[]

  constructor(text: string) {
    const hasTrailingNewline = text.endsWith('\n')
    this.lines = text.split('\n')
    if (hasTrailingNewline) this.lines.pop()
    // 整份文件只有空白，等同于「什么都没有」。留着那几行空行，我们写进去的第一行前面
    // 就会多出一道用户从没写过的空白——空文件是新建文件最常见的形态，不该被我们改坏。
    if (this.lines.every(line => line.trim() === '')) this.lines = []
  }

  get(path: string): string | null {
    const { section, key } = splitTomlPath(path)
    const lineIndex = this.findScalarLine(section, key)
    if (lineIndex < 0) return null
    return parseTomlScalar(this.lines[lineIndex]!)
  }

  set(path: string, value: ConfigScalar): string | null {
    const { section, key } = splitTomlPath(path)
    // TOML 有真布尔/数字，但我们的场景只有字符串（地址、模型名、provider id）值得写；
    // 其余一律按文本写，不做类型猜测。
    const line = `${key} = ${formatTomlScalar(typeof value === 'string' ? value : String(value))}`
    const lineIndex = this.findScalarLine(section, key)
    if (lineIndex >= 0) {
      const before = parseTomlScalar(this.lines[lineIndex]!)
      this.lines[lineIndex] = line
      return before
    }
    // 表还不存在：先把表头立起来。`findSectionEnd` 在找不到表时返回 `-1`，拿它 `+1`
    // 当插入点会把键写在文件第 0 行——那个键就成了根键，跑到别的表里去了。
    if (section !== null && this.findSectionEnd(section) < 0) {
      if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('')
      this.lines.push(`[${section}]`, line)
      return null
    }
    const insertAt = section === null ? this.findRootInsertIndex() : this.findSectionBodyEnd(section) + 1
    this.lines.splice(insertAt, 0, line)
    return null
  }

  setObject(path: string, value: Record<string, unknown>): string | null {
    const start = this.findSectionStart(path)
    const body = Object.entries(value).map(([key, entry]) => {
      if (typeof entry !== 'string') {
        throw new ConfigParseError(`toml provider entry "${key}" must be a string`)
      }
      return `${key} = ${formatTomlScalar(entry)}`
    })
    if (start < 0) {
      if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('')
      this.lines.push(`[${path}]`, ...body)
      return null
    }

    // 已有这张表：只换掉**我们模板里的那几个键**，表里别的行（用户自己加的 key、注释、
    // 空行）一律留在原处。整段重建表体会把它们连根删掉——那是往用户配置里做减法，
    // 而用户加的那些键我们根本没资格判断它是否过时。
    const end = this.findSectionEnd(path)
    const before = this.lines.slice(start + 1, end + 1).join('\n')
    // 从后往前替换，前面的下标才不会因为插入而移位（新键要插在表体末尾，属于插入）。
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== 'string') {
        throw new ConfigParseError(`toml provider entry "${key}" must be a string`)
      }
      const line = `${key} = ${formatTomlScalar(entry)}`
      const lineIndex = this.findScalarLine(path, key)
      if (lineIndex >= 0) {
        this.lines[lineIndex] = line
        continue
      }
      this.lines.splice(this.findSectionBodyEnd(path) + 1, 0, line)
    }
    return before
  }

  serialize(): string {
    return `${this.lines.join('\n')}\n`
  }

  /** 根级键只可能出现在第一个表头之前。 */
  private findRootInsertIndex(): number {
    const firstSection = this.lines.findIndex(line => isTomlSectionHeader(line))
    if (firstSection < 0) {
      return this.lines.length
    }
    // 插在表头之前，并跳过它上方紧邻的空行，免得键和表头之间隔着两个空行。
    let index = firstSection
    while (index > 0 && this.lines[index - 1]!.trim() === '') index -= 1
    return index
  }

  private findSectionStart(section: string): number {
    return this.lines.findIndex(line => isTomlSectionHeader(line) && sectionNameOf(line) === section)
  }

  private findSectionEnd(section: string): number {
    const start = this.findSectionStart(section)
    if (start < 0) return -1
    for (let index = start + 1; index < this.lines.length; index += 1) {
      if (isTomlSectionHeader(this.lines[index]!)) return index - 1
    }
    return this.lines.length - 1
  }

  /**
   * 表体的最后一行**有内容的**行：新键接在它后面。
   *
   * 不能直接用 `findSectionEnd`：那返回的是下一个表头前的最后一行，用户写在两个表之间的
   * 空行也算表体的一部分。拿它当插入点，我们新加的键会**吃掉**那道空行，下一个表头就跟
   * 我们的键贴在一起了——用户排好的版被我们改了一处本不必改的地方。
   */
  private findSectionBodyEnd(section: string): number {
    const start = this.findSectionStart(section)
    let index = this.findSectionEnd(section)
    while (index > start && this.lines[index]!.trim() === '') index -= 1
    return index
  }

  private findScalarLine(section: string | null, key: string): number {
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
    if (section === null) {
      const limit = this.lines.findIndex(line => isTomlSectionHeader(line))
      const end = limit < 0 ? this.lines.length : limit
      for (let index = 0; index < end; index += 1) {
        if (pattern.test(this.lines[index]!)) return index
      }
      return -1
    }
    const start = this.findSectionStart(section)
    if (start < 0) return -1
    const end = this.findSectionEnd(section)
    for (let index = start + 1; index <= end; index += 1) {
      if (pattern.test(this.lines[index]!)) return index
    }
    return -1
  }
}

function isTomlSectionHeader(line: string): boolean {
  return /^\s*\[\[?.+\]\]?\s*(#.*)?$/.test(line)
}

function sectionNameOf(line: string): string {
  const match = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line)
  return match?.[1] ?? ''
}

/** `a.b` → 表 `a` 的键 `b`；`a` → 根级键 `a`。 */
function splitTomlPath(path: string): { section: string | null; key: string } {
  const index = path.lastIndexOf('.')
  if (index < 0) return { section: null, key: path }
  return { section: path.slice(0, index), key: path.slice(index + 1) }
}

function parseTomlScalar(line: string): string | null {
  const raw = line.slice(line.indexOf('=') + 1).trim()
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
  if (raw === '') return null
  // 数组 / 内联表：读不出来，当作「没有值」，而不是把它当成字符串回显出去。
  if (raw.startsWith('[') || raw.startsWith('{')) return null
  return raw
}

function formatTomlScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
