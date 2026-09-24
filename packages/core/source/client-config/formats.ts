import type { ClientConfigFormat } from '@common/client-config'

/**
 * 按格式读写配置文件里的**单个键**，而不是「读成对象再整体重写」。
 *
 * 为什么值得这么麻烦：这些文件是用户自己的配置文件，里面还有与本功能无关的东西
 * （Claude Code 的 `permissions`、Codex 的 sandbox 设置……）。整体 parse → 修改 → 序列化
 * 会顺手把注释、缩进风格、键顺序全部重排一遍，diff 里塞满噪音，用户下次 review 自己的
 * 配置时会不知道哪一行是自己改的。所以：
 *
 *   - `json` / `env` / `toml` 都只动目标键所在的那一处；
 *   - JSON 结构在原对象上原地改，键顺序由 `JSON.parse` → `JSON.stringify` 天然保持；
 *   - TOML 是纯行操作，未触及的行原样保留（注释也在内）。
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
  /** 写标量。 */
  set(path: string, value: ConfigScalar): void
  /**
   * 写一个对象（如 provider 表项）。路径已由调用方把动态段替换成具体值。
   *
   * 值允许嵌套（JSON 的 provider 表项里就有 `options`），但 TOML 与 `.env` 都只有一层，
   * 遇到嵌套会明确报错而不是写出一份语法坏掉的文件。
   */
  setObject(path: string, value: Record<string, unknown>): void
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

class JsonConfigEditor implements ConfigEditor {
  private data: Record<string, unknown>

  constructor(text: string) {
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

  set(path: string, value: ConfigScalar): void {
    setInObject(this.data, splitPath(path), value)
  }

  setObject(path: string, value: Record<string, unknown>): void {
    setInObject(this.data, splitPath(path), { ...value })
  }

  serialize(): string {
    return `${JSON.stringify(this.data, null, 2)}\n`
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
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]!] = value
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

  set(path: string, value: ConfigScalar): void {
    const line = `${path}=${formatEnvValue(typeof value === 'string' ? value : String(value))}`
    const index = this.findLineIndex(path)
    if (index >= 0) {
      this.lines[index] = line
      return
    }
    // 追加在末尾；与原有内容之间留一个空行，但同一批追加出来的键之间不插空行。
    if (!this.appended && this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('')
    this.lines.push(line)
    this.appended = true
  }

  setObject(): void {
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
  }

  get(path: string): string | null {
    const { section, key } = splitTomlPath(path)
    const lineIndex = this.findScalarLine(section, key)
    if (lineIndex < 0) return null
    return parseTomlScalar(this.lines[lineIndex]!)
  }

  set(path: string, value: ConfigScalar): void {
    const { section, key } = splitTomlPath(path)
    // TOML 有真布尔/数字，但我们的场景只有字符串（地址、模型名、provider id）值得写；
    // 其余一律按文本写，不做类型猜测。
    const line = `${key} = ${formatTomlScalar(typeof value === 'string' ? value : String(value))}`
    const lineIndex = this.findScalarLine(section, key)
    if (lineIndex >= 0) {
      this.lines[lineIndex] = line
      return
    }
    const insertAt = section === null ? this.findRootInsertIndex() : this.findSectionEnd(section) + 1
    this.lines.splice(insertAt, 0, line)
  }

  setObject(path: string, value: Record<string, unknown>): void {
    const start = this.findSectionStart(path)
    const body = Object.entries(value).map(([key, entry]) => {
      if (typeof entry !== 'string') {
        throw new ConfigParseError(`toml provider entry "${key}" must be a string`)
      }
      return `${key} = ${formatTomlScalar(entry)}`
    })
    if (start >= 0) {
      // 只替换这一张表的标量体，遇到下一个表头就停（子表不属于这张表）。
      const end = this.findSectionEnd(path)
      const replacement: string[] = []
      for (let index = start + 1; index <= end; index += 1) {
        const line = this.lines[index]!
        const isScalar = /^\s*[A-Za-z0-9_"'-]+\s*=/.test(line)
        if (isScalar) continue
        replacement.push(line)
      }
      // 表内原有的标量行已去掉，空行也一并去掉，保持块干净。
      const cleaned = replacement.filter(line => line.trim() !== '')
      this.lines.splice(start + 1, end - start, ...body, ...(cleaned.length > 0 ? ['', ...cleaned] : []))
      return
    }
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('')
    this.lines.push(`[${path}]`, ...body)
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
