import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@server/errors'
import { githubGistProvider, normalizeGistTarget } from './github-gist'

/**
 * 这里测的是**这个后端自己**的逻辑：句柄怎么规范化、GitHub 的状态码怎么翻成我们的错误码、
 * 分页截断怎么补取全文、未绑定时怎么新建。
 *
 * 出口 HTTP 整体替换成假实现——真打一次 GitHub 会让测试依赖网络与账号，
 * 而我们要验的是「拿到某个响应之后我们怎么做」。
 */
const { requestHttpBuffered } = vi.hoisted(() => ({ requestHttpBuffered: vi.fn() }))

vi.mock('@server/infrastructure/network/core-network', () => ({
  coreNetworkClient: { requestHttpBuffered },
  createCoreNetworkClient: vi.fn(),
}))

const GIST_ID = 'a'.repeat(32)
const TOKEN = 'ghp_secret'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  payload: string
}

/** 最近一次出口请求；拿它断言「我们到底发了什么出去」。 */
function lastCall(): Call {
  const [url, options, payload] = requestHttpBuffered.mock.calls[requestHttpBuffered.mock.calls.length - 1] as [URL, { method: string; headers: Record<string, string> }, Buffer]
  return { url: url.toString(), method: options.method, headers: options.headers, payload: payload.toString('utf8') }
}

/** 让下一次出口请求返回这个响应；对象直接序列化成 JSON 正文。 */
function respond(statusCode: number, body: unknown): void {
  requestHttpBuffered.mockResolvedValueOnce({
    statusCode,
    body: typeof body === 'string' ? body : body === null ? '' : JSON.stringify(body),
  })
}

async function expectAppError(run: () => Promise<unknown>, code: string): Promise<AppError> {
  const error = await run().catch(caught => caught)
  expect(error, `expected an AppError(${code})`).toBeInstanceOf(AppError)
  expect((error as AppError).code).toBe(code)
  return error as AppError
}

beforeEach(() => {
  requestHttpBuffered.mockReset()
})

describe('normalizeGistTarget 句柄规范化', () => {
  it('纯 id 原样返回', () => {
    expect(normalizeGistTarget(GIST_ID)).toBe(GIST_ID)
  })

  // 链接可能带锚点或查询串，先切掉再取最后一段——用户是从地址栏直接复制的。
  it('接受完整链接，切掉锚点与查询串', () => {
    expect(normalizeGistTarget(`https://gist.github.com/octocat/${GIST_ID}`)).toBe(GIST_ID)
    expect(normalizeGistTarget(`https://gist.github.com/${GIST_ID}#file-osw-config-json`)).toBe(GIST_ID)
    expect(normalizeGistTarget(`  ${GIST_ID}?plain=1  `)).toBe(GIST_ID)
    expect(normalizeGistTarget(`https://gist.github.com/${GIST_ID}/`)).toBe(GIST_ID)
  })

  it('大小写不做归一：GitHub 的 id 本来就是大小写不敏感的十六进制串', () => {
    const upper = 'ABCDEF0123456789ABCDEF0123456789'
    expect(normalizeGistTarget(upper)).toBe(upper)
  })

  // 空串表示「解绑」，不是错误。
  it('空白输入返回空串而不是抛错', () => {
    expect(normalizeGistTarget('')).toBe('')
    expect(normalizeGistTarget('   ')).toBe('')
  })

  it('正好 20 位十六进制是下限，19 位就拒绝', () => {
    expect(normalizeGistTarget('b'.repeat(20))).toBe('b'.repeat(20))
    expect(() => normalizeGistTarget('b'.repeat(19))).toThrow(AppError)
  })

  it('认不出来时抛 VALIDATION_ERROR，并把原文带在 details 里', () => {
    let error: AppError | null = null
    try {
      normalizeGistTarget('https://example.com/not-a-gist')
    } catch (caught) {
      error = caught as AppError
    }
    expect(error?.code).toBe('VALIDATION_ERROR')
    expect(error?.statusCode).toBe(400)
    expect(error?.details).toEqual({ target: 'https://example.com/not-a-gist' })
  })
})

describe('githubGistProvider 自述', () => {
  // 界面不认识任何具体后端：标题/占位符全部来自这里的**文案 key**，不是句子。
  it('自述里全是目录 key，不是写死的句子', () => {
    const { descriptor } = githubGistProvider
    expect(descriptor.kind).toBe('github-gist')
    // 未绑定时上传会自动新建一个 Gist，让「第一次同步」只需要点一次按钮。
    expect(descriptor.createsTarget).toBe(true)
    const keys = [
      descriptor.labelKey,
      descriptor.credential.labelKey,
      descriptor.credential.hintKey,
      descriptor.credential.placeholderKey,
      descriptor.target.labelKey,
      descriptor.target.hintKey,
      descriptor.target.placeholderKey,
    ]
    expect(keys.every(key => key.startsWith('settings.cloudSync.backend.'))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('浏览地址是 gist.github.com 上的那个链接', () => {
    expect(githubGistProvider.targetUrl(GIST_ID)).toBe(`https://gist.github.com/${GIST_ID}`)
  })
})

describe('githubGistProvider.verifyCredential 校验令牌', () => {
  it('成功时返回 @账号名，并带上 GitHub 要求的请求头', async () => {
    respond(200, { login: 'octocat' })
    expect(await githubGistProvider.verifyCredential(TOKEN)).toBe('@octocat')

    const call = lastCall()
    expect(call.url).toBe('https://api.github.com/user')
    expect(call.method).toBe('GET')
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(call.headers.Accept).toBe('application/vnd.github+json')
    expect(call.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    // 缺 User-Agent 会被 GitHub 直接 403。
    expect(call.headers['User-Agent']).toBeTruthy()
    // 无正文就不该带 Content-Type/Content-Length。
    expect(call.headers['Content-Type']).toBeUndefined()
    expect(call.headers['Content-Length']).toBeUndefined()
    expect(call.payload).toBe('')
  })

  it('200 但没给账号名也算鉴权失败', async () => {
    respond(200, { login: 42 })
    await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'CLOUD_SYNC_AUTH_FAILED')
  })

  // 401/403 在 Gist 这条路上基本只有一种成因：令牌无效或没勾 gist 权限。
  it('401 与 403 都翻成鉴权失败，并保留 GitHub 的原话', async () => {
    for (const statusCode of [401, 403]) {
      requestHttpBuffered.mockReset()
      respond(statusCode, { message: 'Bad credentials' })
      const error = await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'CLOUD_SYNC_AUTH_FAILED')
      expect(error.statusCode).toBe(502)
      expect(error.message).toContain(`HTTP ${statusCode}`)
      expect(error.message).toContain('Bad credentials')
    }
  })

  it('404 是「没这个 Gist，或者这个令牌看不到它」，给 404 而不是 500', async () => {
    respond(404, { message: 'Not Found' })
    const error = await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'RESOURCE_NOT_FOUND')
    expect(error.statusCode).toBe(404)
  })

  it('422 是请求体被拒，属于可修正的输入问题', async () => {
    respond(422, { message: 'Validation Failed' })
    const error = await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'VALIDATION_ERROR')
    expect(error.statusCode).toBe(400)
  })

  it('其余状态码归到 HTTP_ERROR', async () => {
    respond(503, { message: 'Service Unavailable' })
    const error = await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'HTTP_ERROR')
    expect(error.statusCode).toBe(502)
    expect(error.message).toContain('503')
  })

  // 网关错误页不是 JSON；正文只在拼诊断消息时用得到，解析失败不该盖掉状态码的含义。
  it('非 JSON 正文不影响按状态码翻译，只是没有那句补充说明', async () => {
    respond(500, '<html>oops</html>')
    const error = await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'HTTP_ERROR')
    expect(error.message).toBe('GitHub request failed (HTTP 500)')
  })

  // 连不上是网络问题，不是「本机管理服务的问题」：复用 NETWORK_ERROR 会把排查方向带偏。
  it('连不上时翻成 CLOUD_SYNC_UNREACHABLE，并保留原始错误作为 cause', async () => {
    const underlying = new Error('getaddrinfo ENOTFOUND api.github.com')
    requestHttpBuffered.mockRejectedValueOnce(underlying)
    const error = await expectAppError(() => githubGistProvider.verifyCredential(TOKEN), 'CLOUD_SYNC_UNREACHABLE')
    expect(error.statusCode).toBe(502)
    expect(error.message).toContain('ENOTFOUND')
    expect(error.cause).toBe(underlying)
  })
})

describe('githubGistProvider.readDocument 读快照', () => {
  it('读到了就返回文件内容', async () => {
    respond(200, { files: { 'osw-config.json': { content: '{"a":1}', truncated: false, raw_url: 'https://x/raw' } } })
    expect(await githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json')).toBe('{"a":1}')

    const call = lastCall()
    expect(call.url).toBe(`https://api.github.com/gists/${GIST_ID}`)
    expect(call.method).toBe('GET')
  })

  // 「远端还没有这个文件」是正常状态（新机器第一次拉取之前本来就没有），不是错误。
  it('没有这个文件返回 null', async () => {
    respond(200, { files: { 'other.json': { content: '{}' } } })
    expect(await githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json')).toBeNull()
  })

  it('完全没有 files 字段也返回 null', async () => {
    respond(200, {})
    expect(await githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json')).toBeNull()
  })

  it('文件存在但没给 content 时当作空内容', async () => {
    respond(200, { files: { 'osw-config.json': { truncated: false } } })
    expect(await githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json')).toBe('')
  })

  // GitHub 超过 1MB 只给前 1MB 并标注 truncated，这时必须按 raw_url 再取一次全文，
  // 否则会把**截断的 JSON**当快照导进去。
  it('被截断时按 raw_url 再取一次全文', async () => {
    respond(200, { files: { 'osw-config.json': { content: '{"partial"', truncated: true, raw_url: 'https://gist.githubusercontent.com/raw/osw-config.json' } } })
    respond(200, '{"full":true}')

    expect(await githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json')).toBe('{"full":true}')
    expect(requestHttpBuffered).toHaveBeenCalledTimes(2)

    const rawCall = lastCall()
    expect(rawCall.url).toBe('https://gist.githubusercontent.com/raw/osw-config.json')
    expect(rawCall.method).toBe('GET')
    expect(rawCall.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('被截断但没给 raw_url 时不能糊弄过去，报远端文件非法', async () => {
    respond(200, { files: { 'osw-config.json': { content: '{"partial"', truncated: true } } })
    const error = await expectAppError(
      () => githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json'),
      'CLOUD_SYNC_REMOTE_FILE_INVALID',
    )
    expect(error.statusCode).toBe(502)
  })

  it('补取全文失败时按那个状态码翻译，而不是把半截内容交出去', async () => {
    respond(200, { files: { 'osw-config.json': { content: '{"partial"', truncated: true, raw_url: 'https://x/raw' } } })
    respond(404, { message: 'Not Found' })
    const error = await expectAppError(
      () => githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json'),
      'RESOURCE_NOT_FOUND',
    )
    expect(error.statusCode).toBe(404)
  })

  it('Gist 本身读不到时直接抛，不会返回 null', async () => {
    respond(404, { message: 'Not Found' })
    await expectAppError(
      () => githubGistProvider.readDocument({ credential: TOKEN, target: GIST_ID }, 'osw-config.json'),
      'RESOURCE_NOT_FOUND',
    )
  })
})

describe('githubGistProvider.writeDocument 写快照', () => {
  it('已绑定时覆盖那个 Gist，地址原样带回', async () => {
    respond(200, { id: GIST_ID })
    const result = await githubGistProvider.writeDocument(
      { credential: TOKEN, target: GIST_ID },
      { fileName: 'osw-config.json', content: '{"a":1}' },
    )

    expect(result).toEqual({ target: GIST_ID, created: false })
    const call = lastCall()
    expect(call.method).toBe('PATCH')
    expect(call.url).toBe(`https://api.github.com/gists/${GIST_ID}`)
    expect(JSON.parse(call.payload)).toEqual({ files: { 'osw-config.json': { content: '{"a":1}' } } })
  })

  // 配置里虽然没有明文密钥，但供应商地址、模型名与内部逻辑模型名仍是用户的部署信息。
  it('未绑定时新建一个私密 Gist，并带回新建出来的 id', async () => {
    const created = 'c'.repeat(32)
    respond(201, { id: created })
    const result = await githubGistProvider.writeDocument(
      { credential: TOKEN, target: '' },
      { fileName: 'osw-config.json', content: '{}' },
    )

    expect(result).toEqual({ target: created, created: true })
    const call = lastCall()
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://api.github.com/gists')
    const body = JSON.parse(call.payload) as { description: string; public: boolean; files: Record<string, unknown> }
    expect(body.public).toBe(false)
    expect(body.description).toBe('OSW configuration snapshot')
    expect(Object.keys(body.files)).toEqual(['osw-config.json'])
  })

  it('写请求带 JSON 正文时必须显式给长度（GitHub 对 chunked 的写入并不总是接受）', async () => {
    respond(200, { id: GIST_ID })
    await githubGistProvider.writeDocument({ credential: TOKEN, target: GIST_ID }, { fileName: 'osw-config.json', content: '{}' })

    const call = lastCall()
    expect(call.headers['Content-Type']).toBe('application/json')
    expect(call.headers['Content-Length']).toBe(String(Buffer.byteLength(call.payload, 'utf8')))
    // 多字节内容要按字节数算，不是字符数。
    respond(200, { id: GIST_ID })
    await githubGistProvider.writeDocument({ credential: TOKEN, target: GIST_ID }, { fileName: 'osw-config.json', content: '{"名字":"中文"}' })
    const multiByte = lastCall()
    expect(Number(multiByte.headers['Content-Length'])).toBeGreaterThan(multiByte.payload.length)
  })

  it('新建成功但 GitHub 没回 id 时报连不上，而不是留下一个「写成功了但不知道在哪」的状态', async () => {
    respond(201, {})
    const error = await expectAppError(
      () => githubGistProvider.writeDocument({ credential: TOKEN, target: '' }, { fileName: 'osw-config.json', content: '{}' }),
      'CLOUD_SYNC_UNREACHABLE',
    )
    expect(error.statusCode).toBe(502)
  })

  it('写入被拒时按状态码翻译，不会报「成功」', async () => {
    respond(403, { message: 'Resource not accessible by personal access token' })
    const error = await expectAppError(
      () => githubGistProvider.writeDocument({ credential: TOKEN, target: GIST_ID }, { fileName: 'osw-config.json', content: '{}' }),
      'CLOUD_SYNC_AUTH_FAILED',
    )
    expect(error.message).toContain('Resource not accessible')
  })
})
