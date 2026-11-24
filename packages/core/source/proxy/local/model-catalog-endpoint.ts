import { execFile } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type { LogicalModel } from '@common/schemas'
import { listLogicalModels } from '@server/database/logical-model-store'
import type { LocalEndpoint } from './local-endpoint'

const execFileAsync = promisify(execFile)

/** Codex 自己刷新模型目录的超时也是 5s，多等没有意义。 */
const CODEX_BUNDLED_CATALOG_TIMEOUT_MS = 5_000

/**
 * 桌面端启动的服务进程拿不到用户的 shell `PATH`，因此除了 `PATH` 之外还要看几个
 * 常见的安装目录——不然「Codex 明明装着」与「找不到 codex」会同时成立。
 */
const CODEX_BINARY_DIRECTORIES = [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.cargo', 'bin'),
  join(homedir(), '.volta', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
]

/**
 * Codex 模型目录里一条模型的样子。
 *
 * 只声明我们真正读写的字段：其余字段原样透传（见 {@link buildModelCatalog}），
 * 这样 Codex 往 `ModelInfo` 里加字段时这里不用跟着改。
 */
export interface CodexModelTemplate {
  slug: string
  display_name: string
  description?: string | null
  visibility?: string
  priority?: number
  additional_speed_tiers?: string[]
  service_tiers?: unknown[]
  default_service_tier?: string | null
  upgrade?: unknown
  availability_nux?: unknown
  [key: string]: unknown
}

/**
 * 把一条 Codex 自带模型改写成 osw 的一个逻辑模型。
 *
 * 为什么要**照抄**一条自带模型而不是自己拼一个最小的：Codex 的目录格式里只有 `slug` 等
 * 少数几个字段有缺省值，`display_name`、`supported_reasoning_levels`、`shell_type`、
 * `truncation_policy` 这些都没有——少一个整份目录解析失败。而 `base_instructions`
 * 更是**必填**：它是 Codex 自己的系统提示词，缺了目录直接报错。
 *
 * 那份提示词属于 Codex，osw 既不该自造、也不该冻结一份拷贝（版本会漂）。因此这里以本机
 * 装着的 Codex 自带的模型为骨架，只换掉身份字段——提示词永远与用户实际运行的 CLI 一致。
 */
export function buildModelCatalog(models: readonly LogicalModel[], template: CodexModelTemplate): { models: CodexModelTemplate[] } {
  return {
    models: models.map((model, index) => ({
      ...template,
      slug: model.modelId,
      display_name: model.modelId,
      // 空说明在目录里等同于「没有说明」，但显式写出来更贴近 osw 的事实。
      description: model.description || null,
      // 速度档位与升级路线是 OpenAI 自家模型的销售口径，挂到 osw 的模型上只会误导。
      additional_speed_tiers: [],
      service_tiers: [],
      default_service_tier: null,
      upgrade: null,
      availability_nux: null,
      // Codex 按 priority **从大到小**排，靠前的逻辑模型排前面。
      priority: models.length - index,
    })),
  }
}

/**
 * 兜底的最后一问：让用户的登录 shell 自己回答 codex 在哪。
 *
 * 版本管理器（nvm / fnm / asdf）把 bin 目录装在自己的状态目录里，静态清单穷举不完；
 * 而桌面端启动的进程往往连 `PATH` 都只有系统那几个目录。shell 的启动文件里正好有这些
 * 管理器留下的路径，所以这里问它一次，拿到答案就落成绝对路径用。
 */
async function resolveViaLoginShell(): Promise<string | undefined> {
  const shell = process.env.SHELL
  if (shell === undefined) return undefined
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'command -v codex'], {
      timeout: 3_000,
    })
    // 启动文件可能打印自己的东西，取最后一行；不是绝对路径就当没找到。
    const candidate = stdout.trim().split('\n').pop()?.trim() ?? ''
    if (!isAbsolute(candidate)) return undefined
    return await realpath(candidate)
  } catch {
    return undefined
  }
}

async function findCodexBinary(): Promise<string | undefined> {
  const fromPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map(directory => join(directory, 'codex'))
  for (const candidate of [...fromPath, ...CODEX_BINARY_DIRECTORIES.map(directory => join(directory, 'codex'))]) {
    try {
      await access(candidate, constants.X_OK)
      // fnm / nvm 的 bin 目录常常是指向具体版本的符号链接目录，取真实路径能躲开
      // 「多 shell 会话目录被关掉」之后路径失效的问题。
      return await realpath(candidate)
    } catch {
      // 换下一个候选目录。
    }
  }
  return resolveViaLoginShell()
}

/** 自带目录在进程内只取一次：它只随 Codex 升级而变，而不是随请求变。 */
let bundledTemplate: Promise<CodexModelTemplate> | undefined

async function loadBundledTemplate(): Promise<CodexModelTemplate> {
  const binary = await findCodexBinary()
  if (binary === undefined) throw new Error('codex executable was not found')
  const { stdout } = await execFileAsync(binary, ['debug', 'models', '--bundled'], {
    timeout: CODEX_BUNDLED_CATALOG_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  const template = (JSON.parse(stdout) as { models?: CodexModelTemplate[] }).models?.[0]
  if (template === undefined) throw new Error('codex returned an empty bundled catalog')
  return template
}

function readBundledTemplate(): Promise<CodexModelTemplate> {
  bundledTemplate ??= loadBundledTemplate().catch((error: unknown) => {
    // 失败不缓存：Codex 可能刚装好，下一次请求应该再试一次。
    bundledTemplate = undefined
    throw error
  })
  return bundledTemplate
}

/**
 * `GET /v1/model-catalog`：Codex 的模型目录。
 *
 * 这是 Codex 独有的接口形态（`model_catalog_url`），不是通用的 OpenAI 模型列表——
 * 因此它在对外接口面里属于「认得出但不承诺」，见 `protocols/interface-surface.test.ts`。
 *
 * 为什么需要它：把 Codex 的 provider 指向本机服务之后，`/model` 选择器里只剩 Codex 自带
 * 的那几个模型——osw 的逻辑模型一个都不在。目录接口补的就是这份清单。
 *
 * 只列出**已启用**的逻辑模型。目录取不到（找不到 codex 可执行文件、`debug models` 失败）时
 * 返回 503 而不是空目录：Codex 拿到失败会保留上一次成功的快照，拿到空目录会把选择器清空。
 */
export const modelCatalogEndpoint: LocalEndpoint = {
  method: 'GET',
  path: '/v1/model-catalog',
  async handle(input): Promise<void> {
    const { response } = input
    let catalog: { models: CodexModelTemplate[] }
    try {
      const models = (await listLogicalModels()).filter(model => model.enabled)
      catalog = buildModelCatalog(models, await readBundledTemplate())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 选择器里少了模型是能看见的，但看不见原因：把原因留在日志里。
      console.warn(`[proxy] model catalog unavailable: ${message}`)
      response.statusCode = 503
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: message }))
      return
    }
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(catalog))
  },
}
