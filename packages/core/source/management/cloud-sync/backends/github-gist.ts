import { AppError } from '@server/errors'
import { coreNetworkClient } from '@server/infrastructure/network/core-network'
import type {
  CloudBackupDocument,
  CloudBackupProvider,
  CloudBackupScope,
  CloudBackupWriteResult,
} from './contract'

/**
 * GitHub Gist 承载方式：云同步的第一个后端，也是唯一一个知道 GitHub 长什么样的文件。
 *
 * 走 `coreNetworkClient` 而不是 `fetch`：出站代理（含系统代理与绕过规则）只在那一层实现，
 * 用 `fetch` 会绕开用户在设置页里配的上游代理，在国内网络下表现为「点了没反应」。
 *
 * 它只用到 GitHub REST 的两件事：我是谁（`/user`）与 Gist 的读增改（`/gists`）。
 */

const GITHUB_API_ORIGIN = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
/** GitHub 强制要求带 User-Agent，缺了直接 403。 */
const GITHUB_USER_AGENT = 'OSW-Cloud-Sync'
const REQUEST_TIMEOUT_MILLISECONDS = 15000
/** 自动新建的 Gist 的说明，会显示在 GitHub 的 Gist 列表里。 */
const GIST_DESCRIPTION = 'OSW configuration snapshot'
/** Gist id 是十六进制串；比这个短的一律当成粘错了东西。 */
const GIST_TARGET_PATTERN = /^[0-9a-f]{20,}$/i

export const githubGistProvider: CloudBackupProvider = {
  descriptor: {
    kind: 'github-gist',
    labelKey: 'settings.cloudSync.backend.githubGistLabel',
    // 未绑定时上传会自动建一个 Gist：让「第一次同步」只需要点一次按钮。
    createsTarget: true,
    credential: {
      labelKey: 'settings.cloudSync.backend.githubGistCredentialLabel',
      hintKey: 'settings.cloudSync.backend.githubGistCredentialHint',
      placeholderKey: 'settings.cloudSync.backend.githubGistCredentialPlaceholder',
    },
    target: {
      labelKey: 'settings.cloudSync.backend.githubGistTargetLabel',
      hintKey: 'settings.cloudSync.backend.githubGistTargetHint',
      placeholderKey: 'settings.cloudSync.backend.githubGistTargetPlaceholder',
    },
  },
  normalizeTarget: normalizeGistTarget,
  targetUrl: gistTargetUrl,
  verifyCredential: credential => readGithubLogin(credential),
  readDocument: (scope, fileName) => readGistDocument(scope, fileName),
  writeDocument: (scope, document) => writeGistDocument(scope, document),
}

/**
 * 接受 id 或完整链接，统一成 id。
 *
 * 界面上那句提示只说「粘贴 Gist id 或完整链接」：让用户认识到「地址栏里的东西可以直接粘」
 * 比教他把链接尾部那 32 位挑出来容易得多。链接可能带 `#file-...` 锚点或查询串，先切掉再取最后一段。
 */
export function normalizeGistTarget(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ''
  const withoutFragment = trimmed.split('#')[0].split('?')[0]
  const segments = withoutFragment.split('/').filter(segment => segment.length > 0)
  const candidate = segments.length > 0 ? segments[segments.length - 1] : ''
  if (!GIST_TARGET_PATTERN.test(candidate)) {
    throw new AppError('VALIDATION_ERROR', 400, `Not a gist id or gist url: ${raw}`, { details: { target: raw } })
  }
  return candidate
}

function gistTargetUrl(target: string): string {
  return `https://gist.github.com/${target}`
}

/**
 * 拿令牌去问「我是谁」，用来在保存令牌时立刻判断它能不能用。
 *
 * 界面上的「已连接为 @xxx」是这一步的产物：不校验就落库，用户只会在第一次上传时才发现
 * 令牌是错的，而那时看到的报错离他刚才的操作已经很远了。
 */
async function readGithubLogin(token: string): Promise<string> {
  const data = await githubRequest(token, 'GET', '/user')
  const login = readString(asRecord(data), 'login')
  if (!login) throw new AppError('CLOUD_SYNC_AUTH_FAILED', 502, 'GitHub did not return an account for this token')
  return `@${login}`
}

/** 读快照文件；这个 Gist 里没有该文件时返回 `null`。 */
async function readGistDocument(scope: CloudBackupScope, fileName: string): Promise<string | null> {
  const data = await githubRequest(scope.credential, 'GET', `/gists/${encodeURIComponent(scope.target)}`)
  const file = readFileEntry(data, fileName)
  if (!file) return null
  if (!file.truncated) return file.content
  // 超过 1MB 的文件 GitHub 只给前 1MB，并标注 `truncated`：这时要按 `raw_url` 再取一次全文。
  if (!file.rawUrl) {
    throw new AppError('CLOUD_SYNC_REMOTE_FILE_INVALID', 502, `GitHub truncated ${fileName} and gave no raw url`)
  }
  const raw = await sendRequest(scope.credential, 'GET', new URL(file.rawUrl))
  if (raw.statusCode < 200 || raw.statusCode >= 300) throw toGithubError(raw.statusCode, null)
  return raw.body
}

/**
 * 写快照文件：已绑定就覆盖，未绑定就新建一个**私密** Gist。
 *
 * `public: false` 不是可选项：配置里虽然没有明文密钥，但供应商地址、模型名与内部逻辑模型名
 * 仍然是用户的部署信息，没有理由公开。
 */
async function writeGistDocument(scope: CloudBackupScope, document: CloudBackupDocument): Promise<CloudBackupWriteResult> {
  const files = { [document.fileName]: { content: document.content } }
  if (scope.target.length > 0) {
    await githubRequest(scope.credential, 'PATCH', `/gists/${encodeURIComponent(scope.target)}`, { files })
    return { target: scope.target, created: false }
  }
  const data = await githubRequest(scope.credential, 'POST', '/gists', {
    description: GIST_DESCRIPTION,
    public: false,
    files,
  })
  const id = readString(asRecord(data), 'id')
  if (!id) throw new AppError('CLOUD_SYNC_UNREACHABLE', 502, 'GitHub created a gist but returned no id')
  return { target: id, created: true }
}

interface GithubRawResponse {
  statusCode: number
  body: string
}

async function githubRequest(token: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
  const response = await sendRequest(token, method, new URL(`${GITHUB_API_ORIGIN}${path}`), body)
  const parsed = parseJson(response.body)
  if (response.statusCode >= 200 && response.statusCode < 300) return parsed
  throw toGithubError(response.statusCode, parsed)
}

async function sendRequest(token: string, method: 'GET' | 'POST' | 'PATCH', url: URL, body?: unknown): Promise<GithubRawResponse> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8')
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': GITHUB_USER_AGENT,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
  if (payload.length > 0) {
    headers['Content-Type'] = 'application/json'
    // 显式带长度：不带时 Node 会改用 chunked，GitHub 对 chunked 的写入并不总是接受。
    headers['Content-Length'] = String(payload.length)
  }

  try {
    return await coreNetworkClient.requestHttpBuffered(url, {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout: REQUEST_TIMEOUT_MILLISECONDS,
    }, payload)
  } catch (error) {
    throw toUnreachableError(error)
  }
}

function readFileEntry(data: unknown, fileName: string): { content: string; truncated: boolean; rawUrl: string } | null {
  const files = asRecord(asRecord(data)['files'])
  const entry = asRecord(files[fileName])
  if (Object.keys(entry).length === 0) return null
  return {
    content: readString(entry, 'content') ?? '',
    truncated: entry['truncated'] === true,
    rawUrl: readString(entry, 'raw_url') ?? '',
  }
}

function parseJson(body: string): unknown {
  if (body.length === 0) return null
  try {
    return JSON.parse(body)
  } catch {
    // 非 JSON 的正文（网关错误页等）不当作解析失败：状态码已经能说明问题，
    // 正文只在拼诊断消息时用得到。
    return null
  }
}

/**
 * 把 GitHub 的状态码翻成我们自己的错误码。
 *
 * 界面是按错误码本地化的，所以这里的关键不是把 GitHub 的原文抄过去，而是选一个用户能照做的方向：
 * 401 与 403 在 Gist 这条路上基本只有一种成因（令牌无效 / 没勾 gist 权限），
 * 404 则是「这个 Gist 不存在，或者这个令牌看不到它」——GitHub 故意不区分这两者。
 *
 * 错误码本身是**承载方式无关**的（`CLOUD_SYNC_AUTH_FAILED` 而不是 `..._GITHUB_AUTH_FAILED`）：
 * 否则每接一个后端，界面就要多认一套错误码。
 */
function toGithubError(statusCode: number, parsed: unknown): AppError {
  const detail = readString(asRecord(parsed), 'message') ?? ''
  const suffix = detail ? `: ${detail}` : ''
  if (statusCode === 401 || statusCode === 403) {
    return new AppError('CLOUD_SYNC_AUTH_FAILED', 502, `GitHub rejected the token (HTTP ${statusCode})${suffix}`)
  }
  if (statusCode === 404) {
    return new AppError('RESOURCE_NOT_FOUND', 404, `GitHub could not find that gist (HTTP 404)${suffix}`)
  }
  if (statusCode === 422) {
    return new AppError('VALIDATION_ERROR', 400, `GitHub rejected the request body (HTTP 422)${suffix}`)
  }
  return new AppError('HTTP_ERROR', 502, `GitHub request failed (HTTP ${statusCode})${suffix}`)
}

/**
 * 连不上是网络问题，不是「本机管理服务的问题」——直接复用 `NETWORK_ERROR` 会让界面显示
 * 「连不上本地服务」，把用户引到完全错误的方向上去排查。
 */
function toUnreachableError(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('CLOUD_SYNC_UNREACHABLE', 502, `Could not reach GitHub: ${(error as Error).message}`, { cause: error })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}
